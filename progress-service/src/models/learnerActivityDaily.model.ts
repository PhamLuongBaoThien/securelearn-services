/**
 * Tác dụng và mục đích:
 * Dùng để ghi nhận và thống kê hoạt động học tập hàng ngày của một học viên.
 * Lưu trữ thông tin chi tiết theo từng ngày (dưới dạng chuỗi YYYY-MM-DD) gồm tổng số giây hoạt động,
 * số lượt heartbeat ghi nhận hoạt động, số bài học và số khóa học đã hoàn thành trong ngày đó.
 * Dữ liệu này phục vụ cho việc vẽ biểu đồ hoạt động (heatmap) và tính toán chuỗi ngày học liên tục (streak).
 */
import mongoose, { Document, Schema } from 'mongoose';

export interface ILearnerActivityDaily extends Document {
  userId: string;
  date: string;
  activeSeconds: number;
  heartbeatCount: number;
  completedLessons: number;
  completedCourses: number;
  createdAt: Date;
  updatedAt: Date;
}

const learnerActivityDailySchema = new Schema<ILearnerActivityDaily>(
  {
    userId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    activeSeconds: { type: Number, default: 0, min: 0 },
    heartbeatCount: { type: Number, default: 0, min: 0 },
    completedLessons: { type: Number, default: 0, min: 0 },
    completedCourses: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

learnerActivityDailySchema.index({ userId: 1, date: 1 }, { unique: true });

export const LearnerActivityDaily = mongoose.model<ILearnerActivityDaily>(
  'LearnerActivityDaily',
  learnerActivityDailySchema
);
