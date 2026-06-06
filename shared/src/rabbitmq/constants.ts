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
  MEDIA = 'media.events',
  PAYMENT = 'payment.events',
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

  // --- Media Events ---
  VIDEO_ASSET_READY = 'media.video.ready',
  VIDEO_ASSET_FAILED = 'media.video.failed',
  VIDEO_ASSET_ATTACHED = 'media.video.attached',
  DOCUMENT_ASSET_ATTACHED = 'media.document.attached',

  // --- Payment Events ---
  PAYMENT_COURSE_SUCCEEDED = 'payment.course.succeeded',
  PAYMENT_COURSE_FAILED = 'payment.course.failed',

  // --- Asset Cleanup Events (course-service → media-service) ---
  VIDEO_ASSET_CLEANUP = 'media.video.cleanup',
  DOCUMENT_ASSET_CLEANUP = 'media.document.cleanup',

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
  fullName?: string; // Gửi kèm khi user đổi tên — dùng để đồng bộ instructorName trong course-service
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

export interface VideoAssetStatusPayload {
  videoAssetId: string;
  lessonId: string;
  status: 'READY' | 'FAILED';
  duration?: number;
  manifestKey?: string;
  errorMessage?: string;
}

/** Payload yêu cầu media-service xoá asset vật lý (S3 + DB) */
export interface AssetCleanupPayload {
  assetId: string;
  courseId: string;
  lessonId: string;
}

/** Payload xác nhận asset đã được bind thành công vào lesson */
export interface AssetAttachedPayload {
  assetId: string;
  courseId: string;
  lessonId: string;
}

export type PaymentProvider = 'VNPAY' | 'MOMO';
export type PaymentMethod = 'VNPAY' | 'MOMO';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface PaymentCourseItemPayload {
  courseId: string;
  slug: string;
  title: string;
  price: number;
  thumbnail?: string;
  instructorName?: string;
}

export interface PaymentCourseSucceededPayload {
  transactionId: string;
  transactionCode: string;
  userId: string;
  userRole: string;
  fullName: string;
  email: string;
  provider: PaymentProvider;
  paymentMethod: PaymentMethod;
  amount: number;
  items: PaymentCourseItemPayload[];
  paidAt: string;
}

export interface PaymentCourseFailedPayload {
  transactionId: string;
  transactionCode: string;
  userId: string;
  provider: PaymentProvider;
  paymentMethod: PaymentMethod;
  amount: number;
  reason: string;
  failedAt: string;
}
