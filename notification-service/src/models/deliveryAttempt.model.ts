import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  deliveryKey: { type: String, required: true, unique: true }, campaignId: String,
  userId: { type: String, required: true }, email: { type: String, required: true },
  subject: { type: String, required: true }, body: { type: String, required: true },
  channel: { type: String, default: 'EMAIL' },
  status: { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' },
  attempts: { type: Number, default: 0 }, lastError: String, sentAt: Date,
}, { timestamps: true });
export const DeliveryAttempt = mongoose.model('DeliveryAttempt', schema);