// ========================
// Course Event Handlers
// Mục đích:
// - consume event từ identity, media và payment
// - đồng bộ instructor/course data, trạng thái asset và entitlement thuê bao trong course-service
// ========================
import {
  subscribeMessage,
  Exchange,
  RoutingKey,
  type UserUpdatedPayload,
  type UserDeletedPayload,
  type VideoAssetStatusPayload,
  type PaymentCourseSucceededPayload,
} from '@securelearn/common';
import { Course } from '../models/course.model';
import { CourseVersion } from '../models/courseVersion.model';
import { LessonStatus } from '../models/lesson.model';
import { Enrollment, EnrollmentSource, EnrollmentStatus } from '../models/enrollment.model';
import { Lesson } from '../models/lesson.model';
import { LessonDiscussion } from '../models/lessonDiscussion.model';
import { Section } from '../models/section.model';
import { Quiz } from '../models/quiz.model';
import { QuizAttempt } from '../models/quizAttempt.model';
import lessonService from '../services/lesson.service';
import cartService from '../services/cart.service';
import enrollmentService from '../services/enrollment.service';
import { SubscriptionEntitlement } from '../models/subscriptionEntitlement.model';
import entitlementCacheService from '../services/entitlementCache.service';

type SubscriptionTermChangedPayload = {
  termId: string;
  userId: string;
  planId: string;
  planType: 'MONTHLY' | 'YEARLY';
  status: 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  startsAt: string;
  endsAt: string;
  transactionCode: string;
};

/**
 * Đăng ký lắng nghe tất cả events mà Course Service quan tâm.
 * Gọi hàm này sau khi kết nối RabbitMQ thành công.
 */
export const registerEventHandlers = async (): Promise<void> => {
  // ===== 1. Khi giảng viên cập nhật profile (đổi tên) =====
  await subscribeMessage<UserUpdatedPayload>(
    Exchange.IDENTITY,
    RoutingKey.USER_UPDATED,
    'course-service.user-updated',
    async (payload) => {
      console.log('[CourseEvent] User updated:', payload.userId, '| fields:', payload.updatedFields);

      const discussionAuthorUpdate: Record<string, string> = {};
      if (payload.updatedFields.includes('fullName') && payload.fullName) {
        discussionAuthorUpdate.authorName = payload.fullName;
      }
      if (payload.updatedFields.includes('avatarUrl')) {
        discussionAuthorUpdate.authorAvatarUrl = payload.avatarUrl || '';
      }
      if (Object.keys(discussionAuthorUpdate).length > 0) {
        await LessonDiscussion.updateMany(
          { authorId: payload.userId },
          { $set: discussionAuthorUpdate },
        );
      }

      const instructorProfileUpdate: Record<string, string> = {};
      if (payload.updatedFields.includes('fullName') && payload.fullName) {
        instructorProfileUpdate.instructorName = payload.fullName;
      }
      if (payload.updatedFields.includes('avatarUrl')) {
        instructorProfileUpdate.instructorAvatarUrl = payload.avatarUrl || '';
      }
      if (payload.updatedFields.includes('bio')) {
        instructorProfileUpdate.instructorBio = payload.bio || '';
      }

      if (Object.keys(instructorProfileUpdate).length > 0) {
        const [courseResult, versionResult] = await Promise.all([
          Course.updateMany(
            { instructorId: payload.userId },
            { $set: instructorProfileUpdate }
          ),
          payload.fullName
            ? CourseVersion.updateMany(
                { instructorId: payload.userId },
                { $set: { instructorName: payload.fullName } }
              )
            : Promise.resolve({ modifiedCount: 0 }),
        ]);
        console.log(`[CourseEvent] Đã cập nhật instructor profile cho ${courseResult.modifiedCount} khóa học và ${versionResult.modifiedCount} version của user ${payload.userId}`);
      }
    }
  );

  // ===== 2. Khi user bị xóa tài khoản =====
  await subscribeMessage<UserDeletedPayload>(
    Exchange.IDENTITY,
    RoutingKey.USER_DELETED,
    'course-service.user-deleted',
    async (payload) => {
      console.log(`[CourseEvent] User deleted: ${payload.userId} (${payload.email})`);

      const instructorCourses = await Course.find({ instructorId: payload.userId }).select('_id').lean();
      const courseIds = instructorCourses.map((course) => course._id);

      if (courseIds.length > 0) {
        const versions = await CourseVersion.find({ courseId: { $in: courseIds } }).select('_id').lean();
        const versionIds = versions.map((version) => version._id);
        const lessons = versionIds.length > 0
          ? await Lesson.find({ courseId: { $in: versionIds } }).select('_id').lean()
          : [];
        const lessonIds = lessons.map((lesson) => lesson._id);

        await Promise.all([
          lessonIds.length > 0 ? Quiz.deleteMany({ lessonId: { $in: lessonIds } }) : Promise.resolve(),
          lessonIds.length > 0 ? QuizAttempt.deleteMany({ lessonId: { $in: lessonIds } }) : Promise.resolve(),
          Lesson.deleteMany({ courseId: { $in: versionIds } }),
          Section.deleteMany({ courseId: { $in: versionIds } }),
          CourseVersion.deleteMany({ courseId: { $in: courseIds } }),
          Enrollment.deleteMany({ courseId: { $in: courseIds } }),
          Course.deleteMany({ _id: { $in: courseIds } }),
        ]);
      }
      console.log(`[CourseEvent] Đã xóa ${courseIds.length} khóa học của instructor ${payload.userId}`);

      // Xóa tất cả enrollment của học viên
      const deletedEnrollments = await Enrollment.deleteMany({ userId: payload.userId });
      console.log(`[CourseEvent] Đã xóa ${deletedEnrollments.deletedCount} enrollment của user ${payload.userId}`);
    }
  );

  // ===== 3. Khi video asset xử lý xong hoặc lỗi =====
  await subscribeMessage<VideoAssetStatusPayload>(
    Exchange.MEDIA,
    RoutingKey.VIDEO_ASSET_READY,
    'course-service.video-asset-ready',
    async (payload) => {
      await lessonService.updateVideoLessonState({
        lessonId: payload.lessonId,
        videoAssetId: payload.videoAssetId,
        status: LessonStatus.READY,
        duration: payload.duration,
      });
      console.log(`[CourseEvent] Video asset READY cho lesson ${payload.lessonId}`);
    }
  );

  await subscribeMessage<VideoAssetStatusPayload>(
    Exchange.MEDIA,
    RoutingKey.VIDEO_ASSET_FAILED,
    'course-service.video-asset-failed',
    async (payload) => {
      await lessonService.updateVideoLessonState({
        lessonId: payload.lessonId,
        videoAssetId: payload.videoAssetId,
        status: LessonStatus.FAILED,
      });
      console.log(`[CourseEvent] Video asset FAILED cho lesson ${payload.lessonId}`);
    }
  );

  await subscribeMessage<PaymentCourseSucceededPayload>(
    Exchange.PAYMENT,
    RoutingKey.PAYMENT_COURSE_SUCCEEDED,
    'course-service.payment-course-succeeded',
    async (payload) => {
      // Đây là điểm mở quyền học cho flow mua đứt.
      // payment-service chỉ xác nhận thanh toán; course-service mới là nơi tạo hoặc nâng cấp Enrollment sang PURCHASE.
      console.log(`[CourseEvent] Payment succeeded: ${payload.transactionCode} | user ${payload.userId}`);

      let allSucceeded = true;

      for (const item of payload.items) {
        try {
          await enrollmentService.enroll(payload.userId, item.courseId, payload.userRole, { name: payload.fullName, email: payload.email });
        } catch (error: any) {
          const message = error?.message || 'Không thể ghi danh khóa học từ thanh toán.';
          console.warn(`[CourseEvent] Enroll failed for course ${item.courseId}: ${message}`);

          if (!message.includes('đã ghi danh')) {
            allSucceeded = false;
          }
        }
      }

      if (allSucceeded) {
        await cartService.clearCart(payload.userId);
        console.log(`[CourseEvent] Đã ghi danh và xóa giỏ hàng của user ${payload.userId} sau thanh toán ${payload.transactionCode}`);
      } else {
        console.warn(`[CourseEvent] Thanh toán ${payload.transactionCode} hoàn tất nhưng có ít nhất 1 khóa học chưa ghi danh thành công.`);
      }
    }
  );

  await subscribeMessage<SubscriptionTermChangedPayload>(
    Exchange.PAYMENT,
    'payment.subscription.term-changed' as RoutingKey,
    'course-service.subscription-term-changed',
    async (payload) => {
      // Mirror term local để course-service tự check entitlement mà không cần hỏi payment mỗi request học.
      await SubscriptionEntitlement.findOneAndUpdate(
        { termId: payload.termId },
        {
          $set: {
            userId: payload.userId,
            planId: payload.planId,
            planType: payload.planType,
            status: payload.status,
            startsAt: new Date(payload.startsAt),
            endsAt: new Date(payload.endsAt),
            transactionCode: payload.transactionCode,
          },
        },
        { upsert: true, new: true }
      );

      const subscriptionEnrollments = await Enrollment.find({
        userId: payload.userId,
        subscriptionTermId: payload.termId,
        source: EnrollmentSource.SUBSCRIPTION,
        status: EnrollmentStatus.ACTIVE,
      }).select('courseId').lean();

      const courseIds = subscriptionEnrollments.map((enrollment) => enrollment.courseId);
      const courses = await Course.find({ _id: { $in: courseIds } }).select('_id currentVersionId').lean();
      const versionByCourseId = new Map(courses.map((course) => [
        course._id.toString(),
        course.currentVersionId?.toString() || '',
      ]));

      await Promise.all(subscriptionEnrollments.flatMap((enrollment) => {
        const courseId = enrollment.courseId.toString();
        const versionId = versionByCourseId.get(courseId);
        const idsToCache = versionId && versionId !== courseId ? [courseId, versionId] : [courseId];
        if (payload.status === 'ACTIVE') {
          return idsToCache.map((id) => entitlementCacheService.setAllowed({
            userId: payload.userId,
            courseId: id,
            source: EnrollmentSource.SUBSCRIPTION,
            termId: payload.termId,
            accessEndsAt: new Date(payload.endsAt),
          }));
        }
        return idsToCache.map((id) => entitlementCacheService.del(payload.userId, id));
      }));
      console.log(`[CourseEvent] Subscription term ${payload.termId} -> ${payload.status}`);
    }
  );

  console.log('[CourseEvent] Đã đăng ký lắng nghe tất cả events.');
};

