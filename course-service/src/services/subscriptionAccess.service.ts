// ========================
// Subscription Access Service
// Mục đích:
// - quản lý catalog thuê bao, enroll bằng thuê bao và entitlement khi học
// ========================
import { Course, CourseStatus, SubscriptionCatalogStatus } from '../models/course.model';
import { Enrollment, EnrollmentSource, EnrollmentStatus } from '../models/enrollment.model';
import { Lesson, LessonStatus, LessonType } from '../models/lesson.model';
import { SubscriptionEntitlement } from '../models/subscriptionEntitlement.model';
import enrollmentService from './enrollment.service';
import { CourseVersion } from '../models/courseVersion.model';
import entitlementCacheService from './entitlementCache.service';
import { publishCourseSubscriptionReviewed } from '../events/publishers';

class SubscriptionAccessService {
  private async resolveCourseShellId(courseOrVersionId: string): Promise<string> {
    const shell = await Course.findById(courseOrVersionId).select('_id').lean();
    if (shell) return shell._id.toString();

    const version = await CourseVersion.findById(courseOrVersionId).select('courseId').lean();
    return version?.courseId?.toString() || courseOrVersionId;
  }

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

  public async withdraw(
    courseId: string,
    instructor: { id: string; name?: string; email?: string },
    reason = ''
  ) {
    const instructorId = instructor.id;
    const course = await Course.findOne({ _id: courseId, instructorId });
    if (!course) throw new Error('Khóa học không tồn tại hoặc bạn không có quyền.');
    if (![SubscriptionCatalogStatus.PENDING, SubscriptionCatalogStatus.APPROVED, SubscriptionCatalogStatus.REJECTED].includes(course.subscriptionStatus)) {
      throw new Error('Khóa học hiện không ở trạng thái có thể rút khỏi catalog thuê bao.');
    }
    // Rút khỏi catalog chỉ chặn enroll mới; learner đã học bằng thuê bao vẫn được học tới hết term đang active.
    course.subscriptionStatus = SubscriptionCatalogStatus.REMOVED;
    const reviewedAt = new Date();
    const normalizedReason = reason.trim() || 'Người giảng dạy chủ động rút khóa học khỏi gói thuê bao.';
    course.subscriptionReviewReason = normalizedReason;
    course.subscriptionReviewedAt = reviewedAt;
    course.subscriptionReviewedBy = instructorId;
    course.subscriptionReviewedByName = instructor.name || course.instructorName || '';
    course.subscriptionReviewedByEmail = instructor.email || '';
    course.subscriptionReviewHistory.push({
      action: 'WITHDRAW',
      actorId: instructorId,
      actorRole: 'INSTRUCTOR',
      actorName: instructor.name || course.instructorName || '',
      actorEmail: instructor.email || '',
      reason: normalizedReason,
      reviewedAt,
    });
    await course.save();
    return course;
  }

  public async review(
    courseId: string,
    action: 'APPROVE' | 'REJECT' | 'REMOVE',
    reviewer: { id: string; name?: string; email?: string },
    reason = ''
  ) {
    let course = await Course.findById(courseId);
    if (!course) {
      const version = await CourseVersion.findById(courseId).select('courseId').lean();
      course = version ? await Course.findById(version.courseId) : null;
    }
    if (!course) throw new Error('Khóa học không tồn tại.');
    const normalizedReason = reason.trim();
    if (action === 'APPROVE') {
      if (course.status !== CourseStatus.PUBLISHED || course.subscriptionStatus !== SubscriptionCatalogStatus.PENDING) {
        throw new Error('Chỉ khóa học đã xuất bản và đang chờ duyệt mới được thêm vào catalog.');
      }
      course.subscriptionStatus = SubscriptionCatalogStatus.APPROVED;
    } else if (action === 'REJECT') {
      if (course.subscriptionStatus !== SubscriptionCatalogStatus.PENDING) {
        throw new Error('Chỉ khóa học đang chờ duyệt mới có thể bị từ chối.');
      }
      if (!normalizedReason) throw new Error('Vui lòng nhập lý do từ chối.');
      course.subscriptionStatus = SubscriptionCatalogStatus.REJECTED;
    } else {
      if (course.subscriptionStatus !== SubscriptionCatalogStatus.APPROVED) {
        throw new Error('Chỉ khóa học đang nằm trong gói mới có thể bị rút.');
      }
      if (!normalizedReason) throw new Error('Vui lòng nhập lý do rút khóa học khỏi gói.');
      course.subscriptionStatus = SubscriptionCatalogStatus.REMOVED;
    }
    const reviewedAt = new Date();
    course.subscriptionReviewReason = normalizedReason;
    course.subscriptionReviewedAt = reviewedAt;
    course.subscriptionReviewedBy = reviewer.id;
    course.subscriptionReviewedByName = reviewer.name || '';
    course.subscriptionReviewedByEmail = reviewer.email || '';
    course.subscriptionReviewHistory.push({
      action,
      actorId: reviewer.id,
      actorRole: 'ADMIN',
      actorName: reviewer.name || '',
      actorEmail: reviewer.email || '',
      reason: normalizedReason,
      reviewedAt,
    });
    await course.save();
    try {
      await publishCourseSubscriptionReviewed({
        courseId: course._id.toString(),
        title: course.title,
        slug: course.slug,
        instructorId: course.instructorId,
        action,
        reason: normalizedReason,
        reviewedAt: reviewedAt.toISOString(),
      });
    } catch (err) {
      console.error('Failed to publish COURSE_SUBSCRIPTION_REVIEWED event', err);
    }
    return course;
  }

  public async multiReview(
    courseIds: string[],
    action: 'APPROVE' | 'REJECT' | 'REMOVE',
    reviewer: { id: string; name?: string; email?: string },
    reason = ''
  ) {
    const results = await Promise.all(
      courseIds.map(async (id) => {
        return this.review(id, action, reviewer, reason);
      })
    );
    return results;
  }

  public async catalog() {
    return Course.find({
      status: CourseStatus.PUBLISHED,
      subscriptionStatus: SubscriptionCatalogStatus.APPROVED,
      currentVersionId: { $ne: null },
    }).sort({ enrollmentCount: -1, createdAt: -1 }).lean();
  }

  public async enroll(userId: string, userRole: string, courseId: string, learner: { name?: string; email?: string; avatarUrl?: string } = {}) {
    const now = new Date();
    const term = await SubscriptionEntitlement.findOne({
      userId,
      status: 'ACTIVE',
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    }).sort({ endsAt: -1 });
    if (!term) throw new Error('Bạn không có gói thuê bao đang hoạt động.');
    return enrollmentService.enrollSubscription(userId, courseId, userRole, term.termId, term.endsAt, learner);
  }

  public async entitlement(userId: string, courseId: string) {
    // Hàm kiểm tra quyền học trung tâm cho cả flow mua đứt và thuê bao.
    // Thứ tự là Redis cache trước, rồi mới fallback xuống Mongo Enrollment và SubscriptionEntitlement.
    // Media assets are bound to a CourseVersion while enrollments are bound to the stable Course shell.
    const shellCourseId = await this.resolveCourseShellId(courseId);
    const cached = await entitlementCacheService.get(userId, courseId)
      || (courseId !== shellCourseId ? await entitlementCacheService.get(userId, shellCourseId) : null);
    if (cached) {
      return cached.allowed
        ? {
            allowed: true,
            source: cached.source,
            termId: cached.termId,
            accessEndsAt: cached.accessEndsAt || undefined,
          }
        : { allowed: false, reason: cached.reason || 'NOT_ENTITLED' };
    }

    const enrollment = await Enrollment.findOne({
      userId,
      courseId: shellCourseId,
      status: EnrollmentStatus.ACTIVE,
    });
    if (!enrollment) {
      await entitlementCacheService.setDenied(userId, shellCourseId, 'NOT_ENROLLED');
      if (courseId !== shellCourseId) await entitlementCacheService.setDenied(userId, courseId, 'NOT_ENROLLED');
      return { allowed: false, reason: 'NOT_ENROLLED' };
    }
    if (enrollment.source === EnrollmentSource.PURCHASE) {
      await entitlementCacheService.setAllowed({
        userId,
        courseId: shellCourseId,
        source: EnrollmentSource.PURCHASE,
      });
      if (courseId !== shellCourseId) {
        await entitlementCacheService.setAllowed({
          userId,
          courseId,
          source: EnrollmentSource.PURCHASE,
        });
      }
      return { allowed: true, source: EnrollmentSource.PURCHASE };
    }
    const now = new Date();
    const term = await SubscriptionEntitlement.findOne({
      termId: enrollment.subscriptionTermId,
      userId,
      status: 'ACTIVE',
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    });
    if (!term) {
      await entitlementCacheService.setDenied(userId, shellCourseId, 'SUBSCRIPTION_EXPIRED');
      if (courseId !== shellCourseId) await entitlementCacheService.setDenied(userId, courseId, 'SUBSCRIPTION_EXPIRED');
      return { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' };
    }
    await entitlementCacheService.setAllowed({
      userId,
      courseId: shellCourseId,
      source: EnrollmentSource.SUBSCRIPTION,
      termId: term.termId,
      accessEndsAt: term.endsAt,
    });
    if (courseId !== shellCourseId) {
      await entitlementCacheService.setAllowed({
        userId,
        courseId,
        source: EnrollmentSource.SUBSCRIPTION,
        termId: term.termId,
        accessEndsAt: term.endsAt,
      });
    }
    return { allowed: true, source: EnrollmentSource.SUBSCRIPTION, termId: term.termId, accessEndsAt: term.endsAt };
  }
}

export default new SubscriptionAccessService();

