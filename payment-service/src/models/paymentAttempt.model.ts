// - ghi log chi tiết từng bước thao tác của một giao dịch thanh toán
// - phục vụ kiểm tra lỗi (debug) và phân tích các giao dịch thất bại
// Hàm/luồng sử dụng:
// - checkout
// - confirm
// - webhook

import { Schema, model, Document } from 'mongoose';
import { PaymentMethod, PaymentProvider } from '@securelearn/common';

export interface IPaymentAttempt extends Document {
  transactionId: string;
  transactionCode: string;
  userId: string;
  action: 'CHECKOUT' | 'CONFIRM' | 'WEBHOOK' | 'QUERY';
  provider: PaymentProvider;
  paymentMethod: PaymentMethod;
  success: boolean;
  message?: string;
  rawPayload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const paymentAttemptSchema = new Schema<IPaymentAttempt>(
  {
    transactionId: { type: String, required: true, index: true },
    transactionCode: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    action: { type: String, required: true, enum: ['CHECKOUT', 'CONFIRM', 'WEBHOOK', 'QUERY'] },
    provider: { type: String, required: true, enum: ['VNPAY', 'MOMO'] },
    paymentMethod: { type: String, required: true, enum: ['VNPAY', 'MOMO'] },
    success: { type: Boolean, required: true },
    message: { type: String, default: '' },
    rawPayload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const PaymentAttempt = model<IPaymentAttempt>('PaymentAttempt', paymentAttemptSchema);
