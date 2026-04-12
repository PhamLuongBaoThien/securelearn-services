// ========================
// RabbitMQ Publisher: Gửi message lên Exchange
// ========================
import RabbitMQConnection from './connection';
import { Exchange, RoutingKey } from './constants';

/**
 * Publish một event lên RabbitMQ.
 *
 * @param exchange - Tên exchange (ví dụ: Exchange.IDENTITY)
 * @param routingKey - Routing key (ví dụ: RoutingKey.USER_REGISTERED)
 * @param payload - Dữ liệu gửi kèm (sẽ được JSON.stringify)
 *
 * @example
 * await publishMessage(Exchange.IDENTITY, RoutingKey.USER_REGISTERED, {
 *   userId: user._id,
 *   email: user.email,
 *   fullName: user.fullName,
 *   role: user.role,
 *   registeredAt: new Date().toISOString(),
 * });
 */
export const publishMessage = async <T>(
  exchange: Exchange,
  routingKey: RoutingKey,
  payload: T
): Promise<void> => {
  const channel = RabbitMQConnection.getInstance().getChannel();

  // Đảm bảo exchange tồn tại (idempotent)
  await channel.assertExchange(exchange, 'topic', { durable: true });

  const message = Buffer.from(
    JSON.stringify({
      routingKey,
      payload,
      timestamp: new Date().toISOString(),
    })
  );

  channel.publish(exchange, routingKey, message, {
    persistent: true, // Message không mất khi RabbitMQ restart
    contentType: 'application/json',
  });

  console.log(`[RabbitMQ] Published: ${routingKey}`);
};
