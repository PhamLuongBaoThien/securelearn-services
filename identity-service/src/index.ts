// ========================
// Entry Point: Khởi động Identity Service
// ========================
import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import { RabbitMQConnection } from '@securelearn/common';
import app from './app';
import { seedRolePermissions } from './models/rolePermission.model';

const PORT = process.env.PORT || 5001;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Identity Service...');

    // Kết nối MongoDB Atlas
    await connectDB();

    // Seed RolePermission mặc định (chỉ chạy nếu collection rỗng)
    await seedRolePermissions();

    // Kết nối RabbitMQ (Message Broker)
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);

    // Bật server Express
    app.listen(PORT, () => {
      console.log(`Identity Service đang chạy tại http://localhost:${PORT}`);
      console.log(`API Auth: http://localhost:${PORT}/api/auth`);
    });
  } catch (error) {
    console.error('Khởi động server thất bại:', error);
    process.exit(1); // tác dụng là dừng server nếu có lỗi
  }
};

// ===== Graceful Shutdown =====
// Khi process nhận tín hiệu tắt (Ctrl+C hoặc Docker stop), đóng kết nối sạch sẽ
const gracefulShutdown = async () => {
  console.log('\nĐang tắt Identity Service...');
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);  // Ctrl+C
process.on('SIGTERM', gracefulShutdown); // Docker stop / kill

bootServer();
