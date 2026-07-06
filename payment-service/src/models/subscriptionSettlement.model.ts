/**
 * Mục đích: lưu kết quả chốt doanh thu tháng và chi tiết sổ cái của từng term trong cùng document.
 * Tác dụng: thay thế SubscriptionRevenueLedger riêng, giữ carry/allocation theo term và tổng hợp theo instructor/course.
 */
import { Schema, model, Document } from 'mongoose';
export type SubscriptionSettlementStatus = 'LOCKED' | 'AVAILABLE';
export interface ISubscriptionSettlementAllocation { instructorId: string; courseId: string; courseTitle: string; qualifiedSeconds: number; amount: number; termCount: number; learnerCount: number; sharePercent: number; }
export interface ISubscriptionTermLedgerAllocation { instructorId: string; courseId: string; courseTitle: string; qualifiedSeconds: number; amount: number; }
export interface ISubscriptionTermLedger {
  termId: string; userId: string; recognizedPool: number; carryIn: number; allocatedAmount: number;
  carryOut: number; expiredToAdmin: number; totalQualifiedSeconds: number; allocations: ISubscriptionTermLedgerAllocation[];
}
export interface ISubscriptionSettlement extends Document {
  period: string; status: SubscriptionSettlementStatus; recognizedGross: number; adminRevenue: number; instructorPool: number;
  carriedIn: number; carriedOut: number;
  expiredToAdmin: number; allocatedAmount: number; reconciliationDifference: number; totalQualifiedSeconds: number;
  allocations: ISubscriptionSettlementAllocation[]; termLedgers: ISubscriptionTermLedger[];
  calculatedAt?: Date; lockedAt?: Date; availableAt?: Date;
}
const termAllocationSchema = new Schema<ISubscriptionTermLedgerAllocation>({
  instructorId: { type: String, required: true }, courseId: { type: String, required: true }, courseTitle: { type: String, default: '' },
  qualifiedSeconds: { type: Number, required: true, min: 0 }, amount: { type: Number, required: true, min: 0 },
}, { _id: false });
const termLedgerSchema = new Schema<ISubscriptionTermLedger>({
  termId: { type: String, required: true }, userId: { type: String, required: true }, recognizedPool: { type: Number, default: 0 },
  carryIn: { type: Number, default: 0 }, allocatedAmount: { type: Number, default: 0 }, carryOut: { type: Number, default: 0 },
  expiredToAdmin: { type: Number, default: 0 }, totalQualifiedSeconds: { type: Number, default: 0 }, allocations: { type: [termAllocationSchema], default: [] },
}, { _id: false });
const allocationSchema = new Schema<ISubscriptionSettlementAllocation>({
  instructorId: { type: String, required: true }, courseId: { type: String, required: true }, courseTitle: { type: String, default: '' },
  qualifiedSeconds: { type: Number, required: true, min: 0 }, amount: { type: Number, required: true }, termCount: { type: Number, default: 0 },
  learnerCount: { type: Number, default: 0 }, sharePercent: { type: Number, default: 0 },
}, { _id: false });
const schema = new Schema<ISubscriptionSettlement>({
  period: { type: String, required: true, unique: true, index: true }, status: { type: String, enum: ['LOCKED', 'AVAILABLE'], default: 'LOCKED', index: true },
  recognizedGross: { type: Number, default: 0 }, adminRevenue: { type: Number, default: 0 }, instructorPool: { type: Number, default: 0 },
  carriedIn: { type: Number, default: 0 }, carriedOut: { type: Number, default: 0 }, expiredToAdmin: { type: Number, default: 0 }, allocatedAmount: { type: Number, default: 0 },
  reconciliationDifference: { type: Number, default: 0 }, totalQualifiedSeconds: { type: Number, default: 0 }, allocations: { type: [allocationSchema], default: [] },
  termLedgers: { type: [termLedgerSchema], default: [] }, calculatedAt: { type: Date }, lockedAt: { type: Date }, availableAt: { type: Date },
}, { timestamps: true });
schema.index({ period: 1, 'termLedgers.termId': 1 });
export const SubscriptionSettlement = model<ISubscriptionSettlement>('SubscriptionSettlement', schema);