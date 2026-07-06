// ========================
// SubscriptionUsage Model
// Mục đích:
// - lưu interval duy nhất trên toàn term để xem lại ở tháng khác không được tính trùng
// - periodUsages chỉ ghi số giây mới của từng tháng để phục vụ settlement
// ========================
import { Schema, model, Document } from 'mongoose';

export interface ISubscriptionUsageInterval {
  start: number;
  end: number;
}

export interface ISubscriptionUsagePeriod {
  period: string;
  qualifiedSeconds: number;
}

export interface ISubscriptionUsage extends Document {
  termId: string;
  userId: string;
  courseId: string;
  courseTitle: string;
  instructorId: string;
  lessonId: string;
  sessionId: string;
  eventId: string;
  intervals: ISubscriptionUsageInterval[];
  qualifiedSeconds: number;
  periodUsages: ISubscriptionUsagePeriod[];
  occurredAt: Date;
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  version: number;
}

const intervalSchema = new Schema<ISubscriptionUsageInterval>({
  start: { type: Number, required: true, min: 0 },
  end: { type: Number, required: true, min: 0 },
}, { _id: false });

const periodUsageSchema = new Schema<ISubscriptionUsagePeriod>({
  period: { type: String, required: true },
  qualifiedSeconds: { type: Number, required: true, min: 0 },
}, { _id: false });

const schema = new Schema<ISubscriptionUsage>({
  termId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  courseId: { type: String, required: true, index: true },
  courseTitle: { type: String, default: '' },
  instructorId: { type: String, required: true, index: true },
  lessonId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true },
  eventId: { type: String, required: true, index: true },
  intervals: { type: [intervalSchema], default: [] },
  qualifiedSeconds: { type: Number, required: true, min: 0, default: 0 },
  periodUsages: { type: [periodUsageSchema], default: [] },
  occurredAt: { type: Date, required: true, index: true },
  rangeStartSeconds: { type: Number, required: true, min: 0 },
  rangeEndSeconds: { type: Number, required: true, min: 0 },
  version: { type: Number, required: true, default: 1, min: 1 },
}, { timestamps: true });

schema.index({ termId: 1, userId: 1, courseId: 1, lessonId: 1, instructorId: 1 }, { unique: true });
schema.index({ termId: 1, 'periodUsages.period': 1, instructorId: 1, courseId: 1 });
schema.index({ eventId: 1 });

export const SubscriptionUsage = model<ISubscriptionUsage>('SubscriptionUsage', schema);
