import mongoose, { Schema } from 'mongoose';
const stats = { requested: { type: Number, default: 0 }, inAppSent: { type: Number, default: 0 }, emailSent: { type: Number, default: 0 }, emailFailed: { type: Number, default: 0 } };
const schema = new Schema({
  createdBy: { type: String, required: true },
  audience: { type: String, enum: ['ALL_LEARNERS', 'ALL_INSTRUCTORS', 'ALL_ADMINS', 'ALL_USERS', 'SPECIFIC_USER', 'COURSE_STUDENTS'], required: true },
  specificEmail: String,
  courseId: String,
  title: { type: String, required: true },
  content: { type: String, required: true },
  channels: { type: [String], required: true },
  status: { type: String, enum: ['PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'], default: 'PROCESSING' },
  processingStartedAt: { type: Date, default: null },
  completedAt: Date,
  stats,
}, { timestamps: true });
export const Campaign = mongoose.model('Campaign', schema);