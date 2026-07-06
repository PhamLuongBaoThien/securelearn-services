import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import app from './app';
import redisClient from './config/redis';
import { RabbitMQConnection } from '@securelearn/common';
import { registerEventHandlers } from './events/handlers';
import subscriptionUsageOutboxService from './services/subscriptionUsageOutbox.service';

const PORT = process.env.PORT || 5005;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Progress Service...');

    await connectDB();
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    try {
      await RabbitMQConnection.getInstance().connect(rabbitmqUrl, 1, 1000);
      await registerEventHandlers();
    } catch (error) {
      console.error('[ProgressEvent] RabbitMQ chưa sẵn sàng, progress write vẫn tiếp tục:', error);
    }

    await subscriptionUsageOutboxService.flush();
    setInterval(() => void subscriptionUsageOutboxService.flush(), 10_000).unref();

    app.listen(PORT, () => {
      console.log(`Progress Service đang chạy tại http://localhost:${PORT}`);
      console.log(`API Progress: http://localhost:${PORT}/api/progress`);
    });
  } catch (error) {
    console.error('Khởi động progress service thất bại:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async () => {
  console.log('\nĐang tắt Progress Service...');
  redisClient.disconnect();
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();
