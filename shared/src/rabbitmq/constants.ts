// ========================
// RabbitMQ Constants: Exchange, Routing Key, Event Payloads
// Chỉ định nghĩa những gì đang dùng — thêm dần khi build service mới
// ========================

/**
 * Tên các Exchange trong RabbitMQ.
 * Mỗi domain có 1 exchange riêng. Dùng Topic Exchange.
 */
export enum Exchange {
  IDENTITY = 'identity.events',
  COURSE = 'course.events',
}

/**
 * Routing Keys cho các sự kiện.
 * Format: <domain>.<entity>.<action>
 */
export enum RoutingKey {
  // --- Identity Events ---
  USER_REGISTERED = 'identity.user.registered',
  USER_UPDATED = 'identity.user.updated',
  USER_DELETED = 'identity.user.deleted',

  // --- Course Events (chuẩn bị cho course-service) ---
  COURSE_CREATED = 'course.course.created',
  COURSE_UPDATED = 'course.course.updated',
  COURSE_PUBLISHED = 'course.course.published',
  ENROLLMENT_CREATED = 'course.enrollment.created',
}

// ==============================
// Event Payloads — Interface cho dữ liệu gửi kèm mỗi event
// ==============================

/** Payload khi user mới đăng ký */
export interface UserRegisteredPayload {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  registeredAt: string; // ISO date string
}

/** Payload khi user cập nhật profile */
export interface UserUpdatedPayload {
  userId: string;
  updatedFields: string[];
}

/** Payload khi user bị xóa */
export interface UserDeletedPayload {
  userId: string;
  email: string;
}

/** Payload khi khóa học được tạo */
export interface CourseCreatedPayload {
  courseId: string;
  title: string;
  instructorId: string;
}

/** Payload khi học viên đăng ký khóa học */
export interface EnrollmentCreatedPayload {
  enrollmentId: string;
  userId: string;
  courseId: string;
}
