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
  type EnrollmentCreatedPayload,
  type VideoAssetStatusPayload,
} from './rabbitmq';
