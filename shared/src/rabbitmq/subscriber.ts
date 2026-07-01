import { ConsumeMessage, Options } from 'amqplib';
import RabbitMQConnection from './connection';
import { Exchange } from './constants';

export interface SubscribeOptions {
  retryLimit?: number;
  retryDelaysMs?: number[];
  enableDeadLetter?: boolean;
}

const retryCount = (msg: ConsumeMessage) => Number(msg.properties.headers?.['x-retry-count'] || 0);

export const subscribeMessage = async <T>(
  exchange: Exchange,
  routingKey: string,
  queueName: string,
  handler: (payload: T, routingKey: string) => Promise<void>,
  options: SubscribeOptions = {},
): Promise<void> => {
  const channel = RabbitMQConnection.getInstance().getChannel();
  const retryLimit = Math.max(0, options.retryLimit ?? 0);
  const retryDelays = options.retryDelaysMs?.length ? options.retryDelaysMs : [5000, 30000, 300000];
  const retryExchange = `${exchange}.retry`;
  const deadLetterExchange = `${exchange}.dlx`;

  await channel.assertExchange(exchange, 'topic', { durable: true });
  const q = await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(q.queue, exchange, routingKey);

  if (retryLimit > 0) {
    await channel.assertExchange(retryExchange, 'direct', { durable: true });
    for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
      const retryQueue = `${queueName}.retry.${attempt}`;
      const retryRoute = `${queueName}.${attempt}`;
      await channel.assertQueue(retryQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': retryDelays[Math.min(attempt - 1, retryDelays.length - 1)],
          'x-dead-letter-exchange': exchange,
          'x-dead-letter-routing-key': routingKey,
        },
      });
      await channel.bindQueue(retryQueue, retryExchange, retryRoute);
    }
  }

  if (options.enableDeadLetter) {
    await channel.assertExchange(deadLetterExchange, 'direct', { durable: true });
    const dlq = await channel.assertQueue(`${queueName}.dlq`, { durable: true });
    await channel.bindQueue(dlq.queue, deadLetterExchange, queueName);
  }

  await channel.prefetch(1);
  console.log(JSON.stringify({ level: 'info', event: 'rabbitmq.subscribed', exchange, routingKey, queueName }));

  await channel.consume(q.queue, async (msg: ConsumeMessage | null) => {
    if (!msg) return;
    try {
      const content = JSON.parse(msg.content.toString());
      await handler(content.payload as T, content.routingKey || routingKey);
      channel.ack(msg);
    } catch (error) {
      const attempt = retryCount(msg);
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < retryLimit) {
        const nextAttempt = attempt + 1;
        const publishOptions: Options.Publish = {
          persistent: true,
          contentType: msg.properties.contentType || 'application/json',
          headers: { ...msg.properties.headers, 'x-retry-count': nextAttempt, 'x-original-routing-key': routingKey },
        };
        channel.publish(retryExchange, `${queueName}.${nextAttempt}`, msg.content, publishOptions);
        channel.ack(msg);
        console.warn(JSON.stringify({ level: 'warn', event: 'rabbitmq.retry', queueName, routingKey, attempt: nextAttempt, message }));
        return;
      }

      if (options.enableDeadLetter) {
        channel.publish(deadLetterExchange, queueName, msg.content, {
          persistent: true,
          contentType: msg.properties.contentType || 'application/json',
          headers: { ...msg.properties.headers, 'x-retry-count': attempt, 'x-error-message': message.slice(0, 500) },
        });
        channel.ack(msg);
        console.error(JSON.stringify({ level: 'error', event: 'rabbitmq.dead_letter', queueName, routingKey, attempt, message }));
        return;
      }

      channel.nack(msg, false, false);
      console.error(JSON.stringify({ level: 'error', event: 'rabbitmq.discarded', queueName, routingKey, message }));
    }
  });
};