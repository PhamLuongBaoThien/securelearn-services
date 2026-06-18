// ========================
// RabbitMQ Barrel Export
// Mục đích:
// - gom export của connection, publisher, subscriber và constants dùng chung
// - giúp các service import một điểm duy nhất cho hạ tầng event
// ========================
export { default as RabbitMQConnection } from './connection';
export { publishMessage } from './publisher';
export { subscribeMessage } from './subscriber';
export {
  Exchange,
  RoutingKey,
  type UserRegisteredPayload,
  type UserUpdatedPayload,
  type UserDeletedPayload,
  type CourseCreatedPayload,
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
} from './constants';
