// PaymentTransaction Model
// Mục đích:
// - lưu đơn thanh toán chính của phase 1
// - giữ trạng thái nghiệp vụ: PENDING / SUCCEEDED / FAILED
// - làm source of truth cho order mua khóa học
// Dùng cho:
// - checkout
// - confirm
// - tra cứu transaction

import { Schema, model, Document, Types } from 'mongoose';
import { PaymentMethod, PaymentProvider, PaymentStatus } from '@securelearn/common';

export interface PaymentCourseItem {
  courseId: string;
  slug: string;
  title: string;
  price: number;
  thumbnail?: string;
  instructorName?: string;
}

export interface IPaymentTransaction extends Document {
  transactionCode: string;
  userId: string;
  userRole: string;
  fullName: string;
  email: string;
  items: PaymentCourseItem[];
  amount: number;
  provider: PaymentProvider;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  providerRef?: string;
  failureReason?: string;
  paidAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentCourseItemSchema = new Schema<PaymentCourseItem>(
  {
    courseId: { type: String, required: true },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    thumbnail: { type: String, default: '' },
    instructorName: { type: String, default: '' },
  },
  { _id: false }
);

const paymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    transactionCode: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userRole: { type: String, required: true },
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    items: { type: [paymentCourseItemSchema], required: true },
    amount: { type: Number, required: true, min: 0 },
    provider: { type: String, required: true, enum: ['VNPAY', 'MOMO'] },
    paymentMethod: { type: String, required: true, enum: ['VNPAY', 'MOMO'] },
    status: { type: String, required: true, enum: ['PENDING', 'SUCCEEDED', 'FAILED'], default: 'PENDING' },
    providerRef: { type: String, default: '' },
    failureReason: { type: String, default: '' },
    paidAt: { type: Date },
    failedAt: { type: Date },
  },
  { timestamps: true }
);

paymentTransactionSchema.index({ userId: 1, createdAt: -1 });

export const PaymentTransaction = model<IPaymentTransaction>('PaymentTransaction', paymentTransactionSchema);
