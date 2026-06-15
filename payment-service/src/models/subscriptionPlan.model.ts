// - lưu thông tin các gói thuê bao (tháng, năm) của nền tảng
// - hỗ trợ cấu hình gói (giá, tên) mà không làm ảnh hưởng đến dữ liệu quá khứ
import { Schema, model, Document } from 'mongoose';

export type SubscriptionPlanType = 'MONTHLY' | 'YEARLY';

export interface ISubscriptionPlan extends Document {
  type: SubscriptionPlanType;
  name: string;
  description: string;
  price: number;
  durationDays: number;
  features: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    type: { type: String, enum: ['MONTHLY', 'YEARLY'], required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    price: { type: Number, required: true, min: 1000 },
    durationDays: { type: Number, required: true, enum: [30, 365] },
    features: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const SubscriptionPlan = model<ISubscriptionPlan>('SubscriptionPlan', subscriptionPlanSchema);
