import mongoose, { Schema } from 'mongoose';

const schema = new Schema({
  deliveryKey: { type: String, required: true, unique: true },
  campaignId: String,
  userId: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  channel: { type: String, default: 'EMAIL' },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'SENT', 'FAILED'], default: 'PENDING', index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  sentAt: Date,
  completedAt: Date,
}, { timestamps: true });

schema.index({ status: 1, nextAttemptAt: 1 });
export const DeliveryAttempt = mongoose.model('DeliveryAttempt', schema);