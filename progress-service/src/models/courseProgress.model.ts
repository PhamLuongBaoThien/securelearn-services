/**
 * Tác dụng và mục đích:
 * Dùng để theo dõi tiến độ học tập tổng thể của một học viên trong một khóa học cụ thể.
 * Lưu trữ các thông tin như phần trăm hoàn thành khóa học, số bài học đã hoàn thành,
 * tổng số bài học trong khóa học, bài học cuối cùng đang học dở và thời gian bắt đầu cũng như hoàn thành khóa học.
 */
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
