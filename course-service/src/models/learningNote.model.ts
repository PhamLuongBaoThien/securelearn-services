// - lưu ghi chú cá nhân của từng học viên theo bài học
// - giữ mốc thời gian video gần nhất để học viên quay lại nhanh
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILearningNoteItem {
  _id: Types.ObjectId;
  content: string;
  timestampSec: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILearningNote extends Document {
  userId: string;
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  lessonIdentityId?: Types.ObjectId | null;
  notes: ILearningNoteItem[];
  content?: string;
  timestampSec?: number;
  createdAt: Date;
  updatedAt: Date;
}

const learningNoteItemSchema = new Schema<ILearningNoteItem>(
  {
    content: { type: String, required: true, maxlength: 10_000 },
    timestampSec: { type: Number, default: 0, min: 0 },
  },
  { _id: true, timestamps: true },
);

const learningNoteSchema = new Schema<ILearningNote>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },
    lessonIdentityId: { type: Schema.Types.ObjectId, default: null, index: true },
    notes: { type: [learningNoteItemSchema], default: [] },
    // Giữ lại field cũ để tương thích dữ liệu note legacy 1-note-per-lesson.
    content: { type: String, default: '', maxlength: 10_000 },
    timestampSec: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

learningNoteSchema.index({ userId: 1, courseId: 1, lessonId: 1 }, { unique: true });
learningNoteSchema.index({ userId: 1, courseId: 1, lessonIdentityId: 1 });

export const LearningNote = mongoose.model<ILearningNote>('LearningNote', learningNoteSchema);
