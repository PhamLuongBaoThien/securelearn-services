// - lưu bình luận và trả lời một cấp theo từng bài học
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILessonDiscussion extends Document {
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  replyToId?: Types.ObjectId;
  replyToAuthorName?: string;
  authorId: string;
  authorName: string;
  authorRole: 'STUDENT' | 'INSTRUCTOR';
  content: string;
  replyCount: number;
  editedAt?: Date;
  deletedAt?: Date;
  hiddenAt?: Date;
  hiddenBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const lessonDiscussionSchema = new Schema<ILessonDiscussion>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'LessonDiscussion', default: null, index: true },
    replyToId: { type: Schema.Types.ObjectId, ref: 'LessonDiscussion' },
    replyToAuthorName: String,
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: '' },
    authorRole: { type: String, enum: ['STUDENT', 'INSTRUCTOR'], required: true },
    content: { type: String, required: true, trim: true, maxlength: 2_000 },
    replyCount: { type: Number, default: 0, min: 0 },
    editedAt: Date,
    deletedAt: Date,
    hiddenAt: Date,
    hiddenBy: String,
  },
  { timestamps: true },
);

lessonDiscussionSchema.index({ courseId: 1, lessonId: 1, parentId: 1, _id: -1 });
lessonDiscussionSchema.index({ courseId: 1, parentId: 1, _id: -1 });

export const LessonDiscussion = mongoose.model<ILessonDiscussion>(
  'LessonDiscussion',
  lessonDiscussionSchema,
);
