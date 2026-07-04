import mongoose, { Schema, Types } from 'mongoose';

export const ANNOUNCEMENT_STATUSES = ['PUBLISHED', 'HIDDEN'] as const;
const schema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  instructorId: { type: String, required: true, index: true },
  instructorName: { type: String, default: '' },
  instructorAvatarUrl: { type: String, default: '' },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  content: { type: String, required: true, maxlength: 20000 },
  status: { type: String, enum: ANNOUNCEMENT_STATUSES, default: 'PUBLISHED', index: true },
  revision: { type: Number, default: 1, min: 1 },
  publishedAt: { type: Date, default: Date.now },
  pinnedAt: { type: Date, default: null },
  hiddenAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ courseId: 1, status: 1, pinnedAt: -1, _id: -1 });
export const CourseAnnouncement = mongoose.model('CourseAnnouncement', schema);