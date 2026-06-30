// ========================
// Event Publishers: Phát events từ Course Service ra các service khác
// Tập trung tất cả publishMessage tại một nơi để dễ quản lý
// ========================
import {
  publishMessage,
  Exchange,
  RoutingKey,
  type CourseCreatedPayload,
  type CourseVersionPublishedPayload,
  type EnrollmentCreatedPayload,
  type AssetCleanupPayload,
  type AssetAttachedPayload,
  type CoursePublishedPayload,
  type CourseRejectedPayload,
} from "@securelearn/common";

/**
 * Phát event: Khóa học mới được tạo.
 */
export const publishCourseCreated = async (
  payload: CourseCreatedPayload,
): Promise<void> => {
  await publishMessage<CourseCreatedPayload>(
    Exchange.COURSE,
    RoutingKey.COURSE_CREATED,
    payload,
  );
};

export const publishCoursePublished = async (payload: CoursePublishedPayload): Promise<void> => {
  await publishMessage(Exchange.COURSE, RoutingKey.COURSE_PUBLISHED, payload);
};

export const publishCourseRejected = async (payload: CourseRejectedPayload): Promise<void> => {
  await publishMessage(Exchange.COURSE, RoutingKey.COURSE_REJECTED, payload);
};

export const publishCourseVersionPublished = async (
  payload: CourseVersionPublishedPayload,
): Promise<void> => {
  await publishMessage<CourseVersionPublishedPayload>(
    Exchange.COURSE,
    RoutingKey.COURSE_VERSION_PUBLISHED,
    payload,
  );
};

/**
 * Phát event: Học viên mới ghi danh vào khóa học.
 */
export const publishEnrollmentCreated = async (
  payload: EnrollmentCreatedPayload,
): Promise<void> => {
  await publishMessage<EnrollmentCreatedPayload>(
    Exchange.COURSE,
    RoutingKey.ENROLLMENT_CREATED,
    payload,
  );
};

/**
 * Phát event: Yêu cầu media-service xoá video asset (S3 + DB).
 * Gọi khi unbind video khỏi lesson hoặc đổi type lesson.
 */
export const publishVideoAssetCleanup = async (
  payload: AssetCleanupPayload,
): Promise<void> => {
  await publishMessage<AssetCleanupPayload>(
    Exchange.COURSE,
    RoutingKey.VIDEO_ASSET_CLEANUP,
    payload,
  );
};

/**
 * Phát event: Yêu cầu media-service xoá document asset (S3 + DB).
 * Gọi khi gỡ attachment khỏi lesson hoặc xóa lesson/section/course.
 */
export const publishDocumentAssetCleanup = async (
  payload: AssetCleanupPayload,
): Promise<void> => {
  await publishMessage<AssetCleanupPayload>(
    Exchange.COURSE,
    RoutingKey.DOCUMENT_ASSET_CLEANUP,
    payload,
  );
};

export const publishVideoAssetAttached = async (
  payload: AssetAttachedPayload,
): Promise<void> => {
  await publishMessage<AssetAttachedPayload>(
    Exchange.COURSE,
    RoutingKey.VIDEO_ASSET_ATTACHED,
    payload,
  );
};

export const publishDocumentAssetAttached = async (
  payload: AssetAttachedPayload,
): Promise<void> => {
  await publishMessage<AssetAttachedPayload>(
    Exchange.COURSE,
    RoutingKey.DOCUMENT_ASSET_ATTACHED,
    payload,
  );
};
