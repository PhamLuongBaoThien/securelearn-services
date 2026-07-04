// ========================
// @securelearn/common — Entry Point
// Tập trung export tất cả shared modules
// ========================

// --- Error Classes ---
export {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalError,
} from './errors';

// --- Response Format ---
export { ApiResponse, type IApiResponse } from './responses';

// --- RabbitMQ ---
export {
  RabbitMQConnection,
  publishMessage,
  subscribeMessage,
  Exchange,
  RoutingKey,
  type UserRegisteredPayload,
  type UserUpdatedPayload,
  type UserDeletedPayload,
  type CourseCreatedPayload,
  type CoursePublishedPayload,
  type CourseRejectedPayload,
  type CourseSubmittedForReviewPayload,
  type CourseDiscussionEventPayload,
  type CourseAnnouncementPublishedPayload,
  type NotificationCampaignRequestedPayload,
  type CourseVersionPublishedLessonMapping,
  type CourseVersionPublishedPayload,
  type EnrollmentCreatedPayload,
  type VideoAssetStatusPayload,
  type AssetCleanupPayload,
  type AssetAttachedPayload,
  type PaymentProvider,
  type PaymentMethod,
  type PaymentStatus,
  type PaymentCourseItemPayload,
  type PaymentCourseSucceededPayload,
  type PaymentCourseFailedPayload,
  type ProgressLessonCompletedPayload,
  type ProgressCourseCompletedPayload,
  type SubscriptionTermStatus,
  type SubscriptionTermChangedPayload,
  type InboxEventType,
  type InboxItemCreatedPayload,
  type InboxTicketEventPayload,
} from './rabbitmq';

// --- gRPC ---
export {
  GrpcStatus,
  createGrpcError,
  startGrpcServer,
  createIdentityGrpcServer,
  createIdentityGrpcClient,
  createMediaGrpcServer,
  createCourseGrpcServer,
  createPaymentGrpcServer,
  createMediaGrpcClient,
  createCourseGrpcClient,
  createPaymentGrpcClient,
  type MediaAssetBinding,
  type CourseEntitlementResult,
  type SubscriptionUsageRequest,
  type SubscriptionUsageResult,
} from './grpc';

