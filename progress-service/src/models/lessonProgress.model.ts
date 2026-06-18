import mongoose, { Schema, Document } from 'mongoose';

export enum LessonProgressStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum LessonProgressType {
  VIDEO = 'VIDEO',
  QUIZ = 'QUIZ',
}

export interface ILessonProgress extends Document {
  userId: string;
  courseId: string;
  courseVersionId: string;
  lessonId: string;
  lessonType: LessonProgressType;
  status: LessonProgressStatus;
  watchedSeconds: number;
  durationSeconds: number;
  watchPercent: number;
  quizAttemptId?: string;
  quizScore?: number;
  quizPassed?: boolean;
  lastPositionSeconds: number;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const lessonProgressSchema = new Schema<ILessonProgress>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    courseVersionId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    lessonType: { type: String, enum: Object.values(LessonProgressType), required: true },
    status: {
      type: String,
      enum: Object.values(LessonProgressStatus),
      default: LessonProgressStatus.NOT_STARTED,
      index: true,
    },
    watchedSeconds: { type: Number, default: 0, min: 0 },
    durationSeconds: { type: Number, default: 0, min: 0 },
    watchPercent: { type: Number, default: 0, min: 0, max: 100 },
    quizAttemptId: { type: String, default: '' },
    quizScore: { type: Number, default: 0, min: 0, max: 100 },
    quizPassed: { type: Boolean, default: false },
    lastPositionSeconds: { type: Number, default: 0, min: 0 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

lessonProgressSchema.index({ userId: 1, courseId: 1, lessonId: 1 }, { unique: true });

export const LessonProgress = mongoose.model<ILessonProgress>('LessonProgress', lessonProgressSchema);
