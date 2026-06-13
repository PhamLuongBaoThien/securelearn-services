// ========================
// SubscriptionUsage Model
// Mục đích:
// - lưu các heartbeat đã hợp lệ của người học thuê bao
// - chống tính trùng bằng unique key theo term + lesson + segment
// ========================
import { Schema, model, Document } from 'mongoose';

export interface ISubscriptionUsage extends Document {
  termId: string;
  userId: string;
  courseId: string;
  instructorId: string;
  lessonId: string;
  sessionId: string;
  segmentIndex: number;
  qualifiedSeconds: number;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionUsageSchema = new Schema<ISubscriptionUsage>(
  {
    termId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    instructorId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true },
    segmentIndex: { type: Number, required: true, min: 0 },
    qualifiedSeconds: { type: Number, required: true, min: 1, max: 15 },
    occurredAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

subscriptionUsageSchema.index(
  { termId: 1, userId: 1, lessonId: 1, segmentIndex: 1 },
  { unique: true }
);

export const SubscriptionUsage = model<ISubscriptionUsage>('SubscriptionUsage', subscriptionUsageSchema);
