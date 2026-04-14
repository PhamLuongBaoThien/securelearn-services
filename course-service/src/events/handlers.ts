// ========================
// Event Handlers: Xử lý events nhận từ các service khác
// Course Service subscribe vào Identity events
// ========================
import {
  subscribeMessage,
  Exchange,
  RoutingKey,
  type UserUpdatedPayload,
  type UserDeletedPayload,
} from '@securelearn/common';
import { Course } from '../models/course.model';
import { Enrollment } from '../models/enrollment.model';

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
      console.log('[CourseEvent] User updated:', payload.userId);

      // Nếu user đổi tên → cập nhật instructorName trong tất cả khóa học của họ
      if (payload.updatedFields.includes('fullName')) {
        // Gọi API identity-service để lấy tên mới (tạm thời log)
        // Sau này có thể gọi internal API hoặc cache
        console.log(`[CourseEvent] Cần cập nhật instructorName cho user ${payload.userId}`);
        // TODO: Implement khi có internal API hoặc payload chứa tên mới
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

      // Xóa tất cả khóa học của giảng viên
      const deletedCourses = await Course.deleteMany({ instructorId: payload.userId });
      console.log(`[CourseEvent] Đã xóa ${deletedCourses.deletedCount} khóa học của instructor ${payload.userId}`);

      // Xóa tất cả enrollment của học viên
      const deletedEnrollments = await Enrollment.deleteMany({ userId: payload.userId });
      console.log(`[CourseEvent] Đã xóa ${deletedEnrollments.deletedCount} enrollment của user ${payload.userId}`);
    }
  );

  console.log('[CourseEvent] Đã đăng ký lắng nghe tất cả events.');
};
