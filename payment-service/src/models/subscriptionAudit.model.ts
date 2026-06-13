// ========================
// Subscription Audit Model
// Mục đích:
// - lưu audit log cho các thao tác nhạy cảm của thuê bao
// - phục vụ tra cứu ai đã đổi plan, refund hoặc settlement
// ========================
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
