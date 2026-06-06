// PaymentWebhookEvent Model
// Mục đích:
// - chống xử lý trùng webhook/IPN từ cổng thanh toán
// - lưu dấu event đã nhận để bảo đảm idempotency
// Luồng sử dụng:
// - webhook handler kiểm tra eventId trước khi xử lý

import { Schema, model, Document } from 'mongoose';
import { PaymentProvider } from '@securelearn/common';

export interface IPaymentWebhookEvent extends Document {
  provider: PaymentProvider;
  eventId: string;
  transactionCode: string;
  status: string;
  processedAt: Date;
  rawPayload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const paymentWebhookEventSchema = new Schema<IPaymentWebhookEvent>(
  {
    provider: { type: String, required: true, enum: ['VNPAY', 'MOMO'] },
    eventId: { type: String, required: true },
    transactionCode: { type: String, required: true, index: true },
    status: { type: String, required: true },
    processedAt: { type: Date, required: true, default: () => new Date() },
    rawPayload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

paymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const PaymentWebhookEvent = model<IPaymentWebhookEvent>('PaymentWebhookEvent', paymentWebhookEventSchema);
