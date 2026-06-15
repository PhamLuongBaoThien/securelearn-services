// ========================
// UserSubscriptionTerm Model
// Mục đích:
// - lưu từng kỳ thuê bao đã mua của user
// - dùng làm source of truth cho ACTIVE/SCHEDULED/EXPIRED/REFUNDED
// ========================
import { Schema, model, Document } from 'mongoose';
import type { SubscriptionPlanType } from './subscriptionPlan.model';

export type SubscriptionTermStatus = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';

export interface IUserSubscriptionTerm extends Document {
  userId: string;
  transactionId: string;
  transactionCode: string;
  planId: string;
  planType: SubscriptionPlanType;
  planName: string;
  price: number;
  durationDays: number;
  adminPercent: number;
  instructorPercent: number;
  adminAmount: number;
  instructorPoolAmount: number;
  status: SubscriptionTermStatus;
  startsAt: Date;
  endsAt: Date;
  refundedAt?: Date;
  refundReason?: string;
  refundAdjustmentPeriod?: string;
  refundGrossAdjustment: number;
  refundAdminAdjustment: number;
  refundInstructorPoolAdjustment: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSubscriptionTermSchema = new Schema<IUserSubscriptionTerm>(
  {
    userId: { type: String, required: true, index: true },
    transactionId: { type: String, required: true, unique: true, index: true },
    transactionCode: { type: String, required: true, unique: true, index: true },
    planId: { type: String, required: true, index: true },
    planType: { type: String, enum: ['MONTHLY', 'YEARLY'], required: true },
    planName: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1 },
    adminPercent: { type: Number, required: true, min: 0, max: 100 },
    instructorPercent: { type: Number, required: true, min: 0, max: 100 },
    adminAmount: { type: Number, required: true, min: 0 },
    instructorPoolAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REFUNDED'],
      required: true,
      index: true,
    },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    refundedAt: { type: Date },
    refundReason: { type: String, default: '' },
    refundAdjustmentPeriod: { type: String, default: '', index: true },
    refundGrossAdjustment: { type: Number, default: 0, min: 0 },
    refundAdminAdjustment: { type: Number, default: 0, min: 0 },
    refundInstructorPoolAdjustment: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

userSubscriptionTermSchema.index({ userId: 1, startsAt: 1, endsAt: 1 });

export const UserSubscriptionTerm = model<IUserSubscriptionTerm>('UserSubscriptionTerm', userSubscriptionTermSchema);
