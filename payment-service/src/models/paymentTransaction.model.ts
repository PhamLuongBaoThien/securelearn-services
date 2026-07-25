// - lưu đơn thanh toán chính, trạng thái nghiệp vụ (PENDING/SUCCEEDED/FAILED)
// - là dữ liệu chuẩn để cấp quyền khóa học sau khi thanh toán xong
// Dùng cho:
// - checkout
// - confirm
// - tra cứu transaction

import { Schema, model, Document } from 'mongoose';
import { PaymentMethod, PaymentProvider, PaymentStatus } from '@securelearn/common';

export interface PaymentCourseItem {
  courseId: string;
  slug: string;
  title: string;
  price: number;
  thumbnail?: string;
  instructorName?: string;
  instructorId?: string;
  adminPercent?: number;
  instructorPercent?: number;
  adminAmount?: number;
  instructorAmount?: number;
}

export interface IPaymentTransaction extends Document {
  transactionCode: string;
  userId: string;
  userRole: string;
  fullName: string;
  email: string;
  items: PaymentCourseItem[];
  checkoutMode: 'CART' | 'BUY_NOW';
  grossAmount?: number;
  discountAmount?: number;
  amount: number;
  couponSnapshot?: {
    couponId: string;
    code: string;
    type: 'PERCENT' | 'FIXED';
    value: number;
    discountAmount: number;
  };
  productType: 'COURSE' | 'SUBSCRIPTION';
  subscriptionSnapshot?: {
    planId: string;
    planType: 'MONTHLY' | 'YEARLY';
    name: string;
    durationDays: number;
    adminPercent: number;
    instructorPercent: number;
    adminAmount: number;
    instructorPoolAmount: number;
  };
  provider: PaymentProvider;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  providerRef?: string;
  failureReason?: string;
  paidAt?: Date;
  failedAt?: Date;
  refundedAt?: Date;
  refundedBy?: string;
  refundReason?: string;
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
  instructorId: { type: String, default: '' },
  adminPercent: { type: Number, min: 0, max: 100 },
  instructorPercent: { type: Number, min: 0, max: 100 },
  adminAmount: { type: Number, min: 0 },
  instructorAmount: { type: Number, min: 0 },
  },
  { _id: false }
);

const paymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    transactionCode: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true },
    userRole: { type: String, required: true },
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    items: { type: [paymentCourseItemSchema], required: true },
    checkoutMode: { type: String, enum: ['CART', 'BUY_NOW'], default: 'CART' },
    grossAmount: { type: Number, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    couponSnapshot: {
      couponId: { type: String },
      code: { type: String },
      type: { type: String, enum: ['PERCENT', 'FIXED'] },
      value: { type: Number, min: 0 },
      discountAmount: { type: Number, min: 0 },
    },
    // productType giúp callback/payment return biết giao dịch này cần enroll course hay tạo term thuê bao.
    productType: { type: String, enum: ['COURSE', 'SUBSCRIPTION'], default: 'COURSE' },
    subscriptionSnapshot: {
      planId: { type: String },
      planType: { type: String, enum: ['MONTHLY', 'YEARLY'] },
      name: { type: String },
      durationDays: { type: Number, min: 1 },
      adminPercent: { type: Number, min: 0, max: 100 },
      instructorPercent: { type: Number, min: 0, max: 100 },
      adminAmount: { type: Number, min: 0 },
      instructorPoolAmount: { type: Number, min: 0 },
    },
    provider: { type: String, required: true, enum: ['VNPAY', 'MOMO'] },
    paymentMethod: { type: String, required: true, enum: ['VNPAY', 'MOMO'] },
    status: { type: String, required: true, enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'], default: 'PENDING' },
    providerRef: { type: String, default: '' },
    failureReason: { type: String, default: '' },
    paidAt: { type: Date },
    failedAt: { type: Date },
    refundedAt: { type: Date },
    refundedBy: { type: String, default: '' },
    refundReason: { type: String, default: '' },
  },
  { timestamps: true }
);

paymentTransactionSchema.index({ userId: 1, createdAt: -1 });
paymentTransactionSchema.index({ createdAt: -1 });
paymentTransactionSchema.index({ amount: -1, createdAt: -1 });
paymentTransactionSchema.index({ amount: 1, createdAt: -1 });
paymentTransactionSchema.index({ productType: 1, createdAt: -1 });
paymentTransactionSchema.index({ productType: 1, amount: -1, createdAt: -1 });
paymentTransactionSchema.index({ productType: 1, amount: 1, createdAt: -1 });
paymentTransactionSchema.index({ provider: 1, status: 1, productType: 1, createdAt: -1 });
paymentTransactionSchema.index({ provider: 1, status: 1, productType: 1, amount: -1, createdAt: -1 });
paymentTransactionSchema.index({ provider: 1, status: 1, productType: 1, amount: 1, createdAt: -1 });

export const PaymentTransaction = model<IPaymentTransaction>('PaymentTransaction', paymentTransactionSchema);
