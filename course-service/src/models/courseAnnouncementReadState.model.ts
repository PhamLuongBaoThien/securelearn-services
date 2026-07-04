import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  announcementId: { type: Schema.Types.ObjectId, ref: 'CourseAnnouncement', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  userId: { type: String, required: true, index: true },
  readAt: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ announcementId: 1, userId: 1 }, { unique: true });
export const CourseAnnouncementReadState = mongoose.model('CourseAnnouncementReadState', schema);