/**
 * Mục đích: khởi tạo một payment-service gRPC client dùng chung trong progress-service.
 * Tác dụng: cho worker outbox gửi usage video thuê bao đã xác thực sang payment-service;
 * địa chỉ đích có thể cấu hình bằng PAYMENT_GRPC_TARGET cho local hoặc Docker.
 */
import { createPaymentGrpcClient } from '@securelearn/common';
export const paymentGrpcClient = createPaymentGrpcClient(process.env.PAYMENT_GRPC_TARGET || 'localhost:6004');
