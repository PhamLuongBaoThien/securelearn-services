// - lưu trao đổi giữa học viên đã ghi danh và giảng viên khóa học
// - gắn nội dung với bài học và mốc thời gian video
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILessonDiscussion extends Document {
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  authorId: string;
  authorName: string;
  authorRole: 'STUDENT' | 'INSTRUCTOR';
  content: string;
  timestampSec: number;
  createdAt: Date;
  updatedAt: Date;
}

const lessonDiscussionSchema = new Schema<ILessonDiscussion>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: '' },
    authorRole: { type: String, enum: ['STUDENT', 'INSTRUCTOR'], required: true },
    content: { type: String, required: true, trim: true, maxlength: 2_000 },
    timestampSec: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

lessonDiscussionSchema.index({ courseId: 1, lessonId: 1, createdAt: -1 });

export const LessonDiscussion = mongoose.model<ILessonDiscussion>(
  'LessonDiscussion',
  lessonDiscussionSchema,
);
