// ========================
// Payment Service Entry
// Mục đích:
// - khởi động payment-service, kết nối MongoDB và RabbitMQ
// - seed plan mặc định và bật scheduler cập nhật trạng thái term thuê bao
// ========================
import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import { RabbitMQConnection } from '@securelearn/common';
import app from './app';
import subscriptionService from './services/subscription.service';

const PORT = process.env.PORT || 5004;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Payment Service...');

    await connectDB();

    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);
    // Seed plan mặc định và bật scheduler trạng thái term ngay khi service khởi động.
    await subscriptionService.ensureDefaultPlans();
    await subscriptionService.refreshTermStatuses();
    setInterval(() => {
      subscriptionService.refreshTermStatuses().catch((error) => {
        console.error('[SubscriptionScheduler] Không thể cập nhật trạng thái kỳ thuê bao:', error);
      });
    }, 60_000).unref();

    app.listen(PORT, () => {
      console.log(`Payment Service đang chạy tại http://localhost:${PORT}`);
      console.log(`API Payments: http://localhost:${PORT}/api/payments`);
    });
  } catch (error) {
    console.error('Khởi động payment service thất bại:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async () => {
  console.log('\nĐang tắt Payment Service...');
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();
