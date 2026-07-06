/**
 * Mục đích: lưu mốc thời gian học viên chuyển quyền truy cập một khóa học từ thuê bao sang mua đứt.
 * Tác dụng: payment-service dùng effectiveAt để từ chối usage thuê bao phát sinh sau khi thanh toán mua đứt,
 * kể cả khi course-service chưa kịp cập nhật enrollment; usage trước mốc này vẫn được giữ để chia doanh thu.
 */
import { Schema, model, Document } from 'mongoose';
export interface IPurchaseAccessCutover extends Document { userId: string; courseId: string; transactionId: string; transactionCode: string; effectiveAt: Date; }
const schema = new Schema<IPurchaseAccessCutover>({
  userId: { type: String, required: true, index: true },
  courseId: { type: String, required: true, index: true },
  transactionId: { type: String, required: true },
  transactionCode: { type: String, required: true },
  effectiveAt: { type: Date, required: true, index: true },
}, { timestamps: true });
schema.index({ userId: 1, courseId: 1 }, { unique: true });
export const PurchaseAccessCutover = model<IPurchaseAccessCutover>('PurchaseAccessCutover', schema);
