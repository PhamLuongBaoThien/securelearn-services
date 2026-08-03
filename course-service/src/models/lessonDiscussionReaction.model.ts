import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILessonDiscussionReaction extends Document {
  discussionId: Types.ObjectId;
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  lessonIdentityId?: Types.ObjectId | null;
  userId: string;
  createdAt: Date;
}

const schema = new Schema<ILessonDiscussionReaction>({
  discussionId: { type: Schema.Types.ObjectId, ref: 'LessonDiscussion', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
  lessonIdentityId: { type: Schema.Types.ObjectId, default: null, index: true },
  userId: { type: String, required: true, index: true },
}, { timestamps: true });

schema.index({ discussionId: 1, userId: 1 }, { unique: true });

export const LessonDiscussionReaction = mongoose.model<ILessonDiscussionReaction>(
  'LessonDiscussionReaction',
  schema,
);