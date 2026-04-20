// ========================
// Event Publishers: Phát events từ Course Service ra các service khác
// Tập trung tất cả publishMessage tại một nơi để dễ quản lý
// ========================
import {
  publishMessage,
  Exchange,
  RoutingKey,
  type CourseCreatedPayload,
  type EnrollmentCreatedPayload,
} from '@securelearn/common';

/**
 * Phát event: Khóa học mới được tạo.
 */
export const publishCourseCreated = async (payload: CourseCreatedPayload): Promise<void> => {
  await publishMessage<CourseCreatedPayload>(
    Exchange.COURSE,
    RoutingKey.COURSE_CREATED,
    payload
  );
};

/**
 * Phát event: Học viên mới ghi danh vào khóa học.
 */
export const publishEnrollmentCreated = async (payload: EnrollmentCreatedPayload): Promise<void> => {
  await publishMessage<EnrollmentCreatedPayload>(
    Exchange.COURSE,
    RoutingKey.ENROLLMENT_CREATED,
    payload
  );
};
