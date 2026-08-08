import mongoose, { Schema } from 'mongoose';
export const RECIPIENT_TYPES = ['USER', 'ADMIN'] as const;
export const NOTIFICATION_CATEGORIES = ['PAYMENT', 'COURSE', 'LEARNING', 'INBOX', 'CAMPAIGN'] as const;
export const NOTIFICATION_PRIORITIES = ['NORMAL', 'HIGH'] as const;
const schema = new Schema({
  recipientType: { type: String, enum: RECIPIENT_TYPES, default: 'USER', required: true, index: true },
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  category: { type: String, enum: NOTIFICATION_CATEGORIES, default: 'CAMPAIGN', index: true },
  priority: { type: String, enum: NOTIFICATION_PRIORITIES, default: 'NORMAL' },
  title: { type: String, required: true },
  body: { type: String, required: true },
  actionUrl: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
  data: { type: Schema.Types.Mixed, default: {} },
  readAt: { type: Date, default: null, index: true },
  sourceKey: { type: String, required: true },
}, { timestamps: true });
schema.index({ recipientType: 1, userId: 1, sourceKey: 1 }, { unique: true });
schema.index({ recipientType: 1, userId: 1, createdAt: -1 });
export const Notification = mongoose.model('Notification', schema);
