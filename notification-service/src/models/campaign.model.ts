import mongoose, { Schema } from 'mongoose';
const stats = { requested: { type: Number, default: 0 }, inAppSent: { type: Number, default: 0 }, emailSent: { type: Number, default: 0 }, emailFailed: { type: Number, default: 0 } };
const schema = new Schema({ createdBy: { type: String, required: true }, audience: { type: String, enum: ['ALL_STUDENTS', 'ALL_INSTRUCTORS', 'ALL_USERS', 'SPECIFIC_USER'], required: true }, specificEmail: String, title: { type: String, required: true }, content: { type: String, required: true }, channels: { type: [String], required: true }, status: { type: String, enum: ['PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'], default: 'PROCESSING' }, stats }, { timestamps: true });
export const Campaign = mongoose.model('Campaign', schema);

