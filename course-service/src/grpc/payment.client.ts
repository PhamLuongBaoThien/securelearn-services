import { createPaymentGrpcClient } from '@securelearn/common';

// Heartbeat subscription là hot path lặp lại nhiều lần khi learner học.
// Dùng gRPC để giảm overhead nội bộ, còn HTTP vẫn giữ cho frontend -> course-service.
const paymentGrpcTarget = process.env.PAYMENT_GRPC_TARGET || 'payment-service:6004';

export const paymentGrpcClient = createPaymentGrpcClient(paymentGrpcTarget);
