import mongoose, { Schema, Document } from 'mongoose';

export interface ICourseProgress extends Document {
  userId: string;
  courseId: string;
  courseVersionId: string;
  progressPercent: number;
  completedLessons: number;
  totalLessons: number;
  lastLessonId?: string;
  lastPositionSeconds: number;
  startedAt: Date;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const courseProgressSchema = new Schema<ICourseProgress>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    courseVersionId: { type: String, required: true, index: true },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    completedLessons: { type: Number, default: 0, min: 0 },
    totalLessons: { type: Number, default: 0, min: 0 },
    lastLessonId: { type: String, default: '' },
    lastPositionSeconds: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

courseProgressSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const CourseProgress = mongoose.model<ICourseProgress>('CourseProgress', courseProgressSchema);
