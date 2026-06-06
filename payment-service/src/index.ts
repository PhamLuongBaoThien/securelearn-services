// Entry Point: Khởi động Payment Service
// Mục đích:
// - kết nối MongoDB và RabbitMQ
// - mount Express app cho /api/payments
// - giữ service sống/sạch khi shutdown
// Hàm chính:
// - bootServer(): khởi động toàn bộ service
// - gracefulShutdown(): đóng RabbitMQ an toàn khi dừng app

import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import { RabbitMQConnection } from '@securelearn/common';
import app from './app';

const PORT = process.env.PORT || 5004;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Payment Service...');

    await connectDB();

    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);

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
