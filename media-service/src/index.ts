import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

import app from './app';
import { connectDB } from './config/db';
import { RabbitMQConnection, startGrpcServer } from '@securelearn/common';
import { registerEventHandlers } from './events/handlers';
import videoAssetService from './services/videoAsset.service';
import documentAssetService from './services/documentAsset.service';
import { createInternalGrpcServer } from './grpc/server';

const PORT = process.env.PORT || 5003;
let httpServer: ReturnType<typeof app.listen> | null = null;
const GRPC_BIND = process.env.MEDIA_GRPC_BIND || '0.0.0.0:6003';
let grpcServer: { forceShutdown: () => void } | null = null;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Media Service...');
    await connectDB();

    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);
    await registerEventHandlers();
    videoAssetService.startOrphanCleanupJob();
    videoAssetService.startProcessingTimeoutJob();
    documentAssetService.startOrphanCleanupJob();
    grpcServer = await startGrpcServer(createInternalGrpcServer(), GRPC_BIND);

    httpServer = app.listen(PORT, () => {
      console.log(`Media Service đang chạy tại http://localhost:${PORT}`);
      console.log(`Media gRPC đang chạy tại ${GRPC_BIND}`);
    });
  } catch (error) {
    console.error('Khởi động Media Service thất bại:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async () => {
  console.log('\nĐang tắt Media Service...');
  grpcServer?.forceShutdown();
  await new Promise<void>((resolve) => httpServer ? httpServer.close(() => resolve()) : resolve());
  await mongoose.disconnect();
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();
