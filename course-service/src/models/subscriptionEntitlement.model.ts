// ========================
// SubscriptionEntitlement Model
// Mục đích:
// - mirror trạng thái term từ payment-service sang course-service
// - dùng local entitlement này để check quyền học mà không phụ thuộc projection ở identity-service
// ========================
import mongoose, { Document, Schema } from 'mongoose';

export interface ISubscriptionEntitlement extends Document {
  termId: string;
  userId: string;
  planId: string;
  planType: 'MONTHLY' | 'YEARLY';
  status: 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  startsAt: Date;
  endsAt: Date;
  transactionCode: string;
}

const schema = new Schema<ISubscriptionEntitlement>(
  {
    termId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    planType: { type: String, enum: ['MONTHLY', 'YEARLY'], required: true },
    status: { type: String, enum: ['SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REFUNDED'], required: true, index: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true, index: true },
    transactionCode: { type: String, required: true },
  },
  { timestamps: true }
);

schema.index({ userId: 1, status: 1, endsAt: 1 });

export const SubscriptionEntitlement = mongoose.model<ISubscriptionEntitlement>('SubscriptionEntitlement', schema);
