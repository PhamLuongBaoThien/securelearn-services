/**
 * Mục đích: lưu bền vững các sự kiện usage thuê bao trước khi gửi sang payment-service.
 * Tác dụng: heartbeat vẫn cập nhật tiến độ khi gRPC tạm lỗi, còn worker có thể retry idempotent
 * bằng eventId mà không làm mất hoặc cộng trùng thời gian xem hợp lệ.
 */
import { Schema, model, Document } from 'mongoose';

export type UsageOutboxStatus = 'PENDING' | 'PROCESSING' | 'DONE';

export interface ISubscriptionUsageOutbox extends Document {
  eventId: string;
  payload: {
    termId: string; userId: string; courseId: string; courseTitle: string; instructorId: string;
    lessonId: string; sessionId: string; qualifiedSeconds: number; occurredAt: string;
    rangeStartSeconds: number; rangeEndSeconds: number; eventId: string;
  };
  status: UsageOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
  createdAt: Date;
}

const schema = new Schema<ISubscriptionUsageOutbox>({
  eventId: { type: String, required: true, unique: true, index: true },
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'DONE'], default: 'PENDING', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: () => new Date(), index: true },
  lastError: { type: String, default: '' },
}, { timestamps: true });

schema.index({ status: 1, nextAttemptAt: 1 });
export const SubscriptionUsageOutbox = model<ISubscriptionUsageOutbox>('SubscriptionUsageOutbox', schema);
