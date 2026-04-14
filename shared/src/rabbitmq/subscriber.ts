// ========================
// RabbitMQ Subscriber: Nhận message từ Queue
// ========================
import { ConsumeMessage } from 'amqplib';
import RabbitMQConnection from './connection';
import { Exchange } from './constants';

/**
 * Subscribe nhận event từ RabbitMQ.
 *
 * @param exchange - Tên exchange cần lắng nghe
 * @param routingKey - Routing key pattern (có thể dùng wildcard: `identity.user.*`)
 * @param queueName - Tên queue (ví dụ: 'course-service.user-registered')
 * @param handler - Callback xử lý khi nhận message
 *
 * @example
 * await subscribeMessage(
 *   Exchange.IDENTITY,
 *   RoutingKey.USER_REGISTERED,
 *   'course-service.user-registered',
 *   async (payload, routingKey) => {
 *     console.log('New user registered:', payload);
 *   }
 * );
 */
export const subscribeMessage = async <T>(
  exchange: Exchange,
  routingKey: string,
  queueName: string,
  handler: (payload: T, routingKey: string) => Promise<void>
): Promise<void> => {
  const channel = RabbitMQConnection.getInstance().getChannel();

  // Đảm bảo exchange và queue tồn tại
  await channel.assertExchange(exchange, 'topic', { durable: true });
  const q = await channel.assertQueue(queueName, { durable: true }); // durable: true tức là queue sẽ không bị mất khi restart rabbitmq

  // Bind queue với exchange theo routing key
  await channel.bindQueue(q.queue, exchange, routingKey);

  // Chỉ xử lý 1 message tại một thời điểm (tránh quá tải)
  await channel.prefetch(1);

  console.log(`[RabbitMQ] Subscribed: ${routingKey} -> Queue: ${queueName}`);

  // Consume messages
  await channel.consume(q.queue, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const content = JSON.parse(msg.content.toString());
      await handler(content.payload as T, content.routingKey);

      // Acknowledge — xác nhận đã xử lý xong, RabbitMQ xóa message
      channel.ack(msg);
    } catch (error) {
      console.error(`[RabbitMQ] Lỗi xử lý message ${routingKey}:`, error);

      // Negative acknowledge — đưa vào Dead Letter Queue (nếu có config)
      channel.nack(msg, false, false);
    }
  });
};
