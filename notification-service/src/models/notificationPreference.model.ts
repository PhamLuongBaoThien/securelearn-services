import mongoose, { Schema } from 'mongoose';
const channelSchema = new Schema({ email: { type: Boolean, default: true }, inApp: { type: Boolean, default: true } }, { _id: false });
const schema = new Schema({
  recipientType: { type: String, enum: ['USER', 'ADMIN'], required: true },
  userId: { type: String, required: true },
  categories: {
    PAYMENT: { type: channelSchema, default: () => ({}) },
    COURSE: { type: channelSchema, default: () => ({}) },
    LEARNING: { type: channelSchema, default: () => ({}) },
    INBOX: { type: channelSchema, default: () => ({}) },
    CAMPAIGN: { type: channelSchema, default: () => ({}) },
  },
}, { timestamps: true });
schema.index({ recipientType: 1, userId: 1 }, { unique: true });
export const NotificationPreference = mongoose.model('NotificationPreference', schema);
