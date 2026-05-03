import mongoose, { Document, Schema, Types } from 'mongoose';

export enum LessonType {
  VIDEO = 'VIDEO',
  DOCUMENT = 'DOCUMENT',
  QUIZ = 'QUIZ',
}

export interface ILesson extends Document {
  courseId: Types.ObjectId;
  sectionId: Types.ObjectId;
  title: string;
  type: LessonType;
  content: string;
  duration: number;
  order: number;
  isFreePreview: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const lessonSchema = new Schema<ILesson>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: Object.values(LessonType), default: LessonType.VIDEO },
    content: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    order: { type: Number, required: true },
    isFreePreview: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

lessonSchema.index({ sectionId: 1, order: 1 }, { unique: true });
lessonSchema.index({ courseId: 1 });

export const Lesson = mongoose.model<ILesson>('Lesson', lessonSchema);
