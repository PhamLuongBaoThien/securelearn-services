// ========================
// Coupon Model
// Mục đích:
// - lưu cấu hình coupon do Admin Finance quản lý cho flow mua khóa học
// - giữ điều kiện áp dụng như thời gian hiệu lực, giới hạn lượt dùng và ngưỡng đơn hàng
// Dùng cho:
// - validate coupon trước checkout
// - CRUD coupon ở trang Admin Finance
// ========================
import { Schema, model, Document } from 'mongoose';

export type CouponType = 'PERCENT' | 'FIXED';

export interface ICoupon extends Document {
  code: string;
  name: string;
  type: CouponType;
  value: number;
  maxDiscountAmount?: number;
  minOrderAmount: number;
  usageLimit?: number;
  usedCount: number;
  perUserLimit: number;
  startsAt?: Date;
  endsAt?: Date;
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, index: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ['PERCENT', 'FIXED'] },
    value: { type: Number, required: true, min: 0 },
    maxDiscountAmount: { type: Number, min: 0 },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    usageLimit: { type: Number, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 1, min: 1 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

couponSchema.index({ code: 'text', name: 'text' });

export const Coupon = model<ICoupon>('Coupon', couponSchema);
