// - lưu bình luận và trả lời một cấp theo từng bài học
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILessonDiscussion extends Document {
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  lessonIdentityId?: Types.ObjectId | null;
  parentId: Types.ObjectId | null;
  replyToId?: Types.ObjectId;
  replyToAuthorName?: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string;
  authorRole: 'STUDENT' | 'INSTRUCTOR';
  content: string;
  replyCount: number;
  likeCount: number;
  pinnedAt?: Date;
  pinnedBy?: string;
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
    lessonIdentityId: { type: Schema.Types.ObjectId, default: null, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'LessonDiscussion', default: null, index: true },
    replyToId: { type: Schema.Types.ObjectId, ref: 'LessonDiscussion' },
    replyToAuthorName: String,
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: '' },
    authorAvatarUrl: { type: String, default: '' },
    authorRole: { type: String, enum: ['STUDENT', 'INSTRUCTOR'], required: true },
    content: { type: String, required: true, trim: true, maxlength: 2_000 },
    replyCount: { type: Number, default: 0, min: 0 },
    likeCount: { type: Number, default: 0, min: 0 },
    pinnedAt: Date,
    pinnedBy: String,
    editedAt: Date,
    deletedAt: Date,
    hiddenAt: Date,
    hiddenBy: String,
  },
  { timestamps: true },
);

lessonDiscussionSchema.index({ courseId: 1, lessonId: 1, parentId: 1, _id: -1 });
lessonDiscussionSchema.index({ courseId: 1, lessonId: 1, parentId: 1, pinnedAt: -1 });
lessonDiscussionSchema.index({ courseId: 1, lessonId: 1, parentId: 1, likeCount: -1, _id: -1 });
lessonDiscussionSchema.index({ courseId: 1, lessonIdentityId: 1, parentId: 1, _id: -1 });
lessonDiscussionSchema.index({ courseId: 1, parentId: 1, _id: -1 });

export const LessonDiscussion = mongoose.model<ILessonDiscussion>(
  'LessonDiscussion',
  lessonDiscussionSchema,
);
