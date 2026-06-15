// ========================
// SubscriptionSettlement Model
// Mục đích:
// - chốt doanh thu thuê bao theo kỳ tháng
// - lưu recognized revenue, pool của instructor và phân bổ theo usage
// ========================
import { Schema, model, Document } from 'mongoose';

export type SubscriptionSettlementStatus = 'OPEN' | 'CALCULATED' | 'LOCKED' | 'AVAILABLE';

export interface ISubscriptionSettlementAllocation {
  instructorId: string;
  courseId: string;
  qualifiedSeconds: number;
  amount: number;
}

export interface ISubscriptionSettlement extends Document {
  period: string;
  status: SubscriptionSettlementStatus;
  recognizedGross: number;
  adminRevenue: number;
  instructorPool: number;
  refundGrossAdjustment: number;
  refundAdminAdjustment: number;
  refundInstructorPoolAdjustment: number;
  carriedIn: number;
  carriedOut: number;
  totalQualifiedSeconds: number;
  allocations: ISubscriptionSettlementAllocation[];
  calculatedAt?: Date;
  lockedAt?: Date;
  availableAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const allocationSchema = new Schema<ISubscriptionSettlementAllocation>(
  {
    instructorId: { type: String, required: true },
    courseId: { type: String, required: true },
    qualifiedSeconds: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const subscriptionSettlementSchema = new Schema<ISubscriptionSettlement>(
  {
    period: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['OPEN', 'CALCULATED', 'LOCKED', 'AVAILABLE'], default: 'OPEN', index: true },
    recognizedGross: { type: Number, default: 0 },
    adminRevenue: { type: Number, default: 0 },
    instructorPool: { type: Number, default: 0 },
    refundGrossAdjustment: { type: Number, default: 0 },
    refundAdminAdjustment: { type: Number, default: 0 },
    refundInstructorPoolAdjustment: { type: Number, default: 0 },
    carriedIn: { type: Number, default: 0 },
    carriedOut: { type: Number, default: 0 },
    totalQualifiedSeconds: { type: Number, default: 0 },
    allocations: { type: [allocationSchema], default: [] },
    calculatedAt: { type: Date },
    lockedAt: { type: Date },
    availableAt: { type: Date },
  },
  { timestamps: true }
);

export const SubscriptionSettlement = model<ISubscriptionSettlement>('SubscriptionSettlement', subscriptionSettlementSchema);
