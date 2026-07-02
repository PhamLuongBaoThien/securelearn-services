// ========================
// RabbitMQ Constants
// Mục đích:
// - định nghĩa exchange, routing key và payload dùng chung giữa các service
// - bổ sung event thuê bao để course và identity đồng bộ entitlement/projection
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
  PROGRESS = 'progress.events',
  NOTIFICATION = 'notification.events',
  INBOX = 'inbox.events',
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
  COURSE_VERSION_PUBLISHED = 'course.version.published',
  COURSE_REJECTED = 'course.course.rejected',
  COURSE_SUBMITTED_FOR_REVIEW = 'course.course.submitted-for-review',
  ENROLLMENT_CREATED = 'course.enrollment.created',

  // --- Media Events ---
  VIDEO_ASSET_READY = 'media.video.ready',
  VIDEO_ASSET_FAILED = 'media.video.failed',
  VIDEO_ASSET_ATTACHED = 'media.video.attached',
  DOCUMENT_ASSET_ATTACHED = 'media.document.attached',

  // --- Payment Events ---
  PAYMENT_COURSE_SUCCEEDED = 'payment.course.succeeded',
  PAYMENT_COURSE_FAILED = 'payment.course.failed',
  // Term thuê bao đổi trạng thái sẽ được fan-out sang course/identity để đồng bộ quyền học và projection UI.
  SUBSCRIPTION_TERM_CHANGED = 'payment.subscription.term-changed',

  // --- Asset Cleanup Events (course-service → media-service) ---
  VIDEO_ASSET_CLEANUP = 'media.video.cleanup',
  DOCUMENT_ASSET_CLEANUP = 'media.document.cleanup',

  // --- Progress Events ---
  PROGRESS_LESSON_COMPLETED = 'progress.lesson.completed',
  PROGRESS_COURSE_COMPLETED = 'progress.course.completed',

  // --- Notification Commands ---
  NOTIFICATION_CAMPAIGN_REQUESTED = 'notification.campaign.requested',

  // --- Report/Support events ---
  REPORT_CREATED = 'inbox.report.created',
  SUPPORT_REQUEST_CREATED = 'inbox.support.created',
  FEEDBACK_CREATED = 'inbox.feedback.created',
  INBOX_USER_REPLIED = 'inbox.user.replied',
  INBOX_ADMIN_REPLIED = 'inbox.admin.replied',
  INBOX_STATUS_CHANGED = 'inbox.status.changed',
  INBOX_ASSIGNED = 'inbox.assigned',
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
  avatarUrl?: string; // Cache avatar giảng viên cho course-service
  bio?: string; // Cache tiểu sử giảng viên cho course-service
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
export interface CoursePublishedPayload {
  courseId: string; versionId?: string; title: string; slug?: string; instructorId: string; finalCategoryId?: string; publishedAt: string;
}
export interface CourseRejectedPayload {
  courseId: string; versionId: string; title: string; instructorId: string; reason: string; rejectedAt: string;
}

export interface EnrollmentCreatedPayload {
  enrollmentId: string;
  userId: string;
  courseId: string;
  courseTitle: string;
  instructorId: string;
  learnerName: string;
  learnerEmail: string;
  enrolledAt: string;
}


export interface CourseSubmittedForReviewPayload {
  courseId: string;
  versionId: string;
  title: string;
  instructorId: string;
  instructorName: string;
  submittedAt: string;
}

export interface NotificationCampaignRequestedPayload {
  campaignId: string;
}

export interface CourseVersionPublishedLessonMapping {
  oldLessonId: string;
  newLessonId: string;
  lessonType: 'VIDEO' | 'QUIZ';
}

export interface CourseVersionPublishedPayload {
  courseId: string;
  oldVersionId: string;
  newVersionId: string;
  totalLessons: number;
  publishedAt: string;
  lessonMappings: CourseVersionPublishedLessonMapping[];
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
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

export interface PaymentCourseItemPayload {
  courseId: string;
  slug: string;
  title: string;
  price: number;
  thumbnail?: string;
  instructorName?: string;
  instructorId?: string;
  adminPercent?: number;
  instructorPercent?: number;
  adminAmount?: number;
  instructorAmount?: number;
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

export type SubscriptionTermStatus = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';

export interface SubscriptionTermChangedPayload {
  termId: string;
  userId: string;
  planId: string;
  planType: 'MONTHLY' | 'YEARLY';
  status: SubscriptionTermStatus;
  startsAt: string;
  endsAt: string;
  transactionCode: string;
}

export interface ProgressLessonCompletedPayload {
  userId: string;
  courseId: string;
  courseVersionId: string;
  lessonId: string;
  lessonType: 'VIDEO' | 'QUIZ';
  completedAt: string;
  watchPercent?: number;
  quizAttemptId?: string;
  quizScore?: number;
  quizPassed?: boolean;
}

export interface ProgressCourseCompletedPayload {
  userId: string;
  courseId: string;
  courseVersionId: string;
  completedLessons: number;
  totalLessons: number;
  completedAt: string;
}

export type InboxEventType = 'REPORT' | 'SUPPORT' | 'FEEDBACK';

export interface InboxItemCreatedPayload {
  resourceId: string;
  type: InboxEventType;
  title: string;
  summary?: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  senderRole: string;
  createdAt: string;
  actionUrl?: string;
}
export interface InboxTicketEventPayload {
  eventId: string; ticketId: string; type: InboxEventType; title: string; summary?: string;
  senderId: string; senderName: string; senderEmail: string; senderRole: string; assignedAdminId?: string;
  actorId: string; actorType: 'USER' | 'ADMIN'; status?: string; occurredAt: string; actionUrl: string;
}
