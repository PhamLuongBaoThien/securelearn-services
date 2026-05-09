// ========================
// File này đăng ký các event handler mà course-service cần lắng nghe.
// Hiện tại có 2 nhóm chính:
// - Identity events để đồng bộ/xóa dữ liệu course khi user thay đổi
// - Media events để cập nhật trạng thái lesson video
// Lưu ý:
// - video asset events đã được consume
// - document asset events hiện chưa được consume ở course-service
// ========================
import {
  subscribeMessage,
  Exchange,
  RoutingKey,
  type UserUpdatedPayload,
  type UserDeletedPayload,
  type VideoAssetStatusPayload,
} from '@securelearn/common';
import { Course } from '../models/course.model';
import { LessonStatus } from '../models/lesson.model';
import { Enrollment } from '../models/enrollment.model';
import { Lesson } from '../models/lesson.model';
import { Section } from '../models/section.model';
import lessonService from '../services/lesson.service';

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

      // Nếu giảng viên đổi tên → đồng bộ instructorName trong tất cả khóa học của họ
      if (payload.updatedFields.includes('fullName') && payload.fullName) {
        const result = await Course.updateMany(
          { instructorId: payload.userId },
          { $set: { instructorName: payload.fullName } }
        );
        console.log(`[CourseEvent] Đã cập nhật instructorName thành "${payload.fullName}" cho ${result.modifiedCount} khóa học của user ${payload.userId}`);
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
        await Promise.all([
          Lesson.deleteMany({ courseId: { $in: courseIds } }),
          Section.deleteMany({ courseId: { $in: courseIds } }),
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

  console.log('[CourseEvent] Đã đăng ký lắng nghe tất cả events.');
};
