// - lưu trữ dấu vết (audit log) của các thao tác nhạy cảm liên quan đến thuê bao
// - tra cứu lịch sử thay đổi gói, hoàn tiền hoặc chốt đối soát
import { Schema, model } from 'mongoose';

const subscriptionAuditSchema = new Schema(
  {
    actorId: { type: String, required: true, index: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true, index: true },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const SubscriptionAudit = model('SubscriptionAudit', subscriptionAuditSchema);
