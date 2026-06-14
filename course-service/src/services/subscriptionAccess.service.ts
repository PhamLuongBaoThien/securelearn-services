// ========================
// Subscription Access Service
// Mục đích:
// - quản lý catalog thuê bao, enroll bằng thuê bao và entitlement khi học
// - validate heartbeat trước khi gửi usage hợp lệ sang payment-service
// ========================
import { Course, CourseStatus, SubscriptionCatalogStatus } from '../models/course.model';
import { Enrollment, EnrollmentSource, EnrollmentStatus } from '../models/enrollment.model';
import { Lesson, LessonStatus, LessonType } from '../models/lesson.model';
import { PlaybackSession } from '../models/playbackSession.model';
import { SubscriptionEntitlement } from '../models/subscriptionEntitlement.model';
import enrollmentService from './enrollment.service';
import { CourseVersion } from '../models/courseVersion.model';
import { paymentGrpcClient } from '../grpc/payment.client';

class SubscriptionAccessService {
  public async optIn(courseId: string, instructorId: string) {
    const course = await Course.findOne({ _id: courseId, instructorId });
    if (!course) throw new Error('Khóa học không tồn tại hoặc bạn không có quyền.');
    if (course.status !== CourseStatus.PUBLISHED || !course.currentVersionId) throw new Error('Chỉ khóa học đã xuất bản mới được đăng ký catalog thuê bao.');
    // V1 chỉ cho course có ít nhất một video READY tham gia catalog thuê bao.
    const hasReadyVideo = await Lesson.exists({
      courseId: course.currentVersionId,
      type: LessonType.VIDEO,
      status: LessonStatus.READY,
    });
    if (!hasReadyVideo) throw new Error('Khóa học phải có ít nhất một video READY.');
    course.subscriptionStatus = SubscriptionCatalogStatus.PENDING;
    course.subscriptionReviewReason = '';
    await course.save();
    return course;
  }

  public async withdraw(courseId: string, instructorId: string, reason = '') {
    const course = await Course.findOne({ _id: courseId, instructorId });
    if (!course) throw new Error('Khóa học không tồn tại hoặc bạn không có quyền.');
    if (![SubscriptionCatalogStatus.PENDING, SubscriptionCatalogStatus.APPROVED, SubscriptionCatalogStatus.REJECTED].includes(course.subscriptionStatus)) {
      throw new Error('Khóa học hiện không ở trạng thái có thể rút khỏi catalog thuê bao.');
    }
    // Rút khỏi catalog chỉ chặn enroll mới; learner đã học bằng thuê bao vẫn được học tới hết term đang active.
    course.subscriptionStatus = SubscriptionCatalogStatus.REMOVED;
    course.subscriptionReviewReason = reason.trim() || 'Instructor withdrew the course from subscription catalog.';
    course.subscriptionReviewedAt = new Date();
    await course.save();
    return course;
  }

  public async review(courseId: string, action: 'APPROVE' | 'REJECT' | 'REMOVE', reason = '') {
    let course = await Course.findById(courseId);
    if (!course) {
      const version = await CourseVersion.findById(courseId).select('courseId').lean();
      course = version ? await Course.findById(version.courseId) : null;
    }
    if (!course) throw new Error('Khóa học không tồn tại.');
    if (action === 'APPROVE') {
      if (course.status !== CourseStatus.PUBLISHED || course.subscriptionStatus !== SubscriptionCatalogStatus.PENDING) {
        throw new Error('Chỉ khóa học đã xuất bản và đang chờ duyệt mới được thêm vào catalog.');
      }
      course.subscriptionStatus = SubscriptionCatalogStatus.APPROVED;
    } else if (action === 'REJECT') {
      course.subscriptionStatus = SubscriptionCatalogStatus.REJECTED;
    } else {
      course.subscriptionStatus = SubscriptionCatalogStatus.REMOVED;
    }
    course.subscriptionReviewReason = reason.trim();
    course.subscriptionReviewedAt = new Date();
    await course.save();
    return course;
  }

  public async catalog() {
    return Course.find({
      status: CourseStatus.PUBLISHED,
      subscriptionStatus: SubscriptionCatalogStatus.APPROVED,
      currentVersionId: { $ne: null },
    }).sort({ enrollmentCount: -1, createdAt: -1 }).lean();
  }

  public async enroll(userId: string, userRole: string, courseId: string) {
    const now = new Date();
    const term = await SubscriptionEntitlement.findOne({
      userId,
      status: 'ACTIVE',
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    }).sort({ endsAt: -1 });
    if (!term) throw new Error('Bạn không có gói thuê bao đang hoạt động.');
    return enrollmentService.enrollSubscription(userId, courseId, userRole, term.termId, term.endsAt);
  }

  public async entitlement(userId: string, courseId: string) {
    const enrollment = await Enrollment.findOne({ userId, courseId, status: EnrollmentStatus.ACTIVE });
    if (!enrollment) return { allowed: false, reason: 'NOT_ENROLLED' };
    if (enrollment.source === EnrollmentSource.PURCHASE) return { allowed: true, source: EnrollmentSource.PURCHASE };
    const now = new Date();
    const term = await SubscriptionEntitlement.findOne({
      termId: enrollment.subscriptionTermId,
      userId,
      status: 'ACTIVE',
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    });
    return term
      ? { allowed: true, source: EnrollmentSource.SUBSCRIPTION, termId: term.termId, accessEndsAt: term.endsAt }
      : { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' };
  }

  public async heartbeat(userId: string, input: {
    courseId: string;
    lessonId: string;
    sessionId: string;
    segmentIndex: number;
    qualifiedSeconds: number;
  }) {
    // Heartbeat chỉ được ghi nhận khi learner đang học bằng quyền thuê bao còn hiệu lực.
    const access = await this.entitlement(userId, input.courseId);
    if (!access.allowed || access.source !== EnrollmentSource.SUBSCRIPTION || !access.termId) {
      throw new Error('Không có quyền thuê bao hợp lệ cho heartbeat này.');
    }
    const course = await Course.findById(input.courseId).lean();
    if (!course?.currentVersionId) throw new Error('Khóa học không tồn tại.');
    if (course.instructorId === userId) throw new Error('Instructor không được tính usage cho khóa học của chính mình.');
    const lesson = await Lesson.findOne({
      _id: input.lessonId,
      courseId: course.currentVersionId,
      type: LessonType.VIDEO,
      status: LessonStatus.READY,
    }).lean();
    if (!lesson) throw new Error('Video không hợp lệ.');

    const segmentIndex = Math.max(0, Math.floor(Number(input.segmentIndex)));
    if (segmentIndex * 15 >= lesson.duration) throw new Error('Đoạn xem vượt quá thời lượng video.');
    const now = new Date();
    const activeSession = await PlaybackSession.findOne({ userId });
    if (activeSession && activeSession.sessionId !== input.sessionId && activeSession.lastSeenAt.getTime() > now.getTime() - 30_000) {
      throw new Error('Tài khoản đang có một phiên phát khác hoạt động.');
    }
    if (!activeSession || activeSession.sessionId !== input.sessionId || activeSession.lessonId !== input.lessonId) {
      await PlaybackSession.findOneAndUpdate(
        { userId },
        {
          $set: {
            sessionId: input.sessionId,
            lessonId: input.lessonId,
            lastSegmentIndex: -1,
            startedAt: now,
            lastSeenAt: now,
          },
        },
        { upsert: true, new: true }
      );
      return { accepted: false, reason: 'SESSION_STARTED' };
    }
    const qualifiedSeconds = Math.min(15, Math.max(1, Math.floor(Number(input.qualifiedSeconds))));
    const elapsedSeconds = (now.getTime() - activeSession.lastSeenAt.getTime()) / 1000;
    if (elapsedSeconds + 2 < qualifiedSeconds) {
      throw new Error('Heartbeat đến sớm hơn thời gian xem thực tế.');
    }
    await PlaybackSession.findOneAndUpdate(
      { userId },
      { $set: { lastSegmentIndex: segmentIndex, lastSeenAt: now } },
      { upsert: true, new: true }
    );

    // Heartbeat là hot path nội bộ nên chuyển sang gRPC thay vì HTTP/JSON.
    return paymentGrpcClient.recordSubscriptionUsage({
      termId: access.termId,
      userId,
      courseId: input.courseId,
      instructorId: course.instructorId,
      lessonId: input.lessonId,
      sessionId: input.sessionId,
      segmentIndex,
      qualifiedSeconds,
      occurredAt: now.toISOString(),
    });
  }
}

export default new SubscriptionAccessService();
