// ========================
// Payment Service Entry
// Mục đích:
// - khởi động payment-service, kết nối MongoDB và RabbitMQ
// - seed plan mặc định và bật scheduler cập nhật trạng thái term thuê bao
// ========================
import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import { RabbitMQConnection, startGrpcServer } from '@securelearn/common';
import app from './app';
import subscriptionService from './services/subscription.service';
import paymentService from './services/payment.service';
import { createInternalGrpcServer } from './grpc/server';

const PORT = process.env.PORT || 5004;
const GRPC_BIND = process.env.PAYMENT_GRPC_BIND || '0.0.0.0:6004';
let grpcServer: { forceShutdown: () => void } | null = null;

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
    // IPN local có thể gián đoạn khi tunnel đổi URL; query định kỳ giữ trạng thái MoMo đồng bộ.
    paymentService.reconcilePendingMomoTransactions().catch((error) => {
      console.error('[MomoReconcile] Không thể đối soát giao dịch lúc khởi động:', error);
    });
    setInterval(() => {
      paymentService.reconcilePendingMomoTransactions().catch((error) => {
        console.error('[MomoReconcile] Không thể đối soát giao dịch:', error);
      });
    }, 30_000).unref();
    grpcServer = await startGrpcServer(createInternalGrpcServer(), GRPC_BIND);

    app.listen(PORT, () => {
      console.log(`Payment Service đang chạy tại http://localhost:${PORT}`);
      console.log(`API Payments: http://localhost:${PORT}/api/payments`);
      console.log(`Payment gRPC đang chạy tại ${GRPC_BIND}`);
    });
  } catch (error) {
    console.error('Khởi động payment service thất bại:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async () => {
  console.log('\nĐang tắt Payment Service...');
  grpcServer?.forceShutdown();
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();
