// ========================
// Coupon Redemption Model
// Mục đích:
// - ghi nhận coupon đã được dùng thành công theo user và transaction
// - hỗ trợ kiểm soát perUserLimit, usageLimit và tránh tăng lượt dùng lặp lại
// Dùng cho:
// - finalize transaction thành công
// - thống kê số lượt dùng coupon
// ========================
import { Schema, model, Document } from 'mongoose';

export interface ICouponRedemption extends Document {
  couponId: string;
  code: string;
  userId: string;
  transactionId: string;
  transactionCode: string;
  discountAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

const couponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    couponId: { type: String, required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, index: true },
    userId: { type: String, required: true, index: true },
    transactionId: { type: String, required: true, unique: true },
    transactionCode: { type: String, required: true, unique: true },
    discountAmount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

couponRedemptionSchema.index({ couponId: 1, userId: 1 });

export const CouponRedemption = model<ICouponRedemption>('CouponRedemption', couponRedemptionSchema);
