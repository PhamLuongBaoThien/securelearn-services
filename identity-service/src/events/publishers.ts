// ========================
// Event Publishers: Phát events từ Identity Service ra các service khác
// Tập trung tất cả publishMessage tại một nơi để dễ quản lý
// ========================
import {
  publishMessage,
  Exchange,
  RoutingKey,
  type UserRegisteredPayload,
  type UserUpdatedPayload,
  type UserDeletedPayload,
} from '@securelearn/common';

/**
 * Phát event: User mới đăng ký thành công.
 */
export const publishUserRegistered = async (payload: UserRegisteredPayload): Promise<void> => {
  await publishMessage<UserRegisteredPayload>(
    Exchange.IDENTITY,
    RoutingKey.USER_REGISTERED,
    payload
  );
};

/**
 * Phát event: User đã cập nhật thông tin profile (fullName, avatarUrl, role...).
 */
export const publishUserUpdated = async (payload: UserUpdatedPayload): Promise<void> => {
  await publishMessage<UserUpdatedPayload>(
    Exchange.IDENTITY,
    RoutingKey.USER_UPDATED,
    payload
  );
};

/**
 * Phát event: User đã bị xóa tài khoản.
 */
export const publishUserDeleted = async (payload: UserDeletedPayload): Promise<void> => {
  await publishMessage<UserDeletedPayload>(
    Exchange.IDENTITY,
    RoutingKey.USER_DELETED,
    payload
  );
};
