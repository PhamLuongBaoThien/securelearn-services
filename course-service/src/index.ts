// ========================
// Entry Point: Khởi động Course Service
// ========================
import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import { RabbitMQConnection, startGrpcServer } from '@securelearn/common';
import { registerEventHandlers } from './events/handlers';
import app from './app';
import { createInternalGrpcServer } from './grpc/server';

const PORT = process.env.PORT || 5002;
const GRPC_BIND = process.env.COURSE_GRPC_BIND || '0.0.0.0:6002';
let grpcServer: { forceShutdown: () => void } | null = null;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Course Service...');

    // Kết nối MongoDB
    await connectDB();

    // Kết nối RabbitMQ
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);

    // Đăng ký lắng nghe events từ các service khác
    await registerEventHandlers();

    grpcServer = await startGrpcServer(createInternalGrpcServer(), GRPC_BIND);

    // Bật server Express
    app.listen(PORT, () => {
      console.log(`Course Service đang chạy tại http://localhost:${PORT}`);
      console.log(`API Courses: http://localhost:${PORT}/api/courses`);
      console.log(`Course gRPC đang chạy tại ${GRPC_BIND}`);
    });
  } catch (error) {
    console.error('Khởi động server thất bại:', error);
    process.exit(1);
  }
};

// ===== Graceful Shutdown =====
const gracefulShutdown = async () => {
  console.log('\nĐang tắt Course Service...');
  grpcServer?.forceShutdown();
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();
