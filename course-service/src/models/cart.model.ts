// - quản lý giỏ hàng của user
// - lưu trữ các khóa học user định mua trước khi thanh toán
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICartItem {
  courseId: Types.ObjectId;
  addedAt: Date;
}

export interface ICart extends Document {
  userId: string;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const cartSchema = new Schema<ICart>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true }
);

cartSchema.index({ userId: 1, 'items.courseId': 1 });

export const Cart = mongoose.model<ICart>('Cart', cartSchema);
