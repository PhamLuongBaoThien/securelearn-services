import mongoose, { Schema } from 'mongoose';
export const TEMPLATE_EVENTS = ['WELCOME', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'COURSE_APPROVED', 'COURSE_REJECTED', 'COURSE_SUBMITTED_FOR_REVIEW', 'ENROLLMENT_CREATED', 'MANUAL'] as const;
export const TEMPLATE_CHANNELS = ['EMAIL', 'IN_APP'] as const;
const schema = new Schema({ name: { type: String, required: true, trim: true }, event: { type: String, enum: TEMPLATE_EVENTS, required: true }, type: { type: String, enum: TEMPLATE_CHANNELS, required: true }, subject: { type: String, trim: true }, body: { type: String, required: true }, variables: { type: [String], default: [] }, isActive: { type: Boolean, default: true } }, { timestamps: true });
schema.index({ event: 1, type: 1 }, { unique: true });
export const NotificationTemplate = mongoose.model('NotificationTemplate', schema);

