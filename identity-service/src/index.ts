// ========================
// Identity Service Entry
// Mục đích:
// - khởi động identity-service, seed role permission và kết nối RabbitMQ
// - lắng nghe event thuê bao để đồng bộ projection subscriptionStatus cho UI
// ========================
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

import { connectDB } from './config/db';
import { RabbitMQConnection, startGrpcServer } from '@securelearn/common';
import app from './app';
import { seedRolePermissions } from './models/rolePermission.model';
import { registerEventHandlers } from './events/handlers';
import { createInternalGrpcServer } from './grpc/server';
import { User } from './models/user.model';
import publicProfileSlugService from './services/publicProfileSlug.service';

const PORT = process.env.PORT || 5001;
let httpServer: ReturnType<typeof app.listen> | null = null;
const GRPC_BIND = process.env.IDENTITY_GRPC_BIND || '0.0.0.0:6001';
let grpcServer: { forceShutdown: () => void } | null = null;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Identity Service...');

    // Kết nối MongoDB Atlas
    await connectDB();

    await User.updateMany({ emailVerifiedAt: { $exists: false } }, [{ $set: { emailVerifiedAt: { $ifNull: ['$createdAt', new Date()] } } }]);
    await publicProfileSlugService.ensureExistingUsers();

    // Seed RolePermission mặc định (chỉ chạy nếu collection rỗng)
    await seedRolePermissions();

    // Kết nối RabbitMQ (Message Broker)
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);
    // Bật consumer để projection subscriptionStatus luôn theo kịp lifecycle term từ payment-service.
    await registerEventHandlers();

    grpcServer = await startGrpcServer(createInternalGrpcServer(), GRPC_BIND);

    // Bật server Express
    httpServer = app.listen(PORT, () => {
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
  grpcServer?.forceShutdown();
  await new Promise<void>((resolve) => httpServer ? httpServer.close(() => resolve()) : resolve());
  await mongoose.disconnect();
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);  // Ctrl+C
process.on('SIGTERM', gracefulShutdown); // Docker stop / kill

bootServer();
