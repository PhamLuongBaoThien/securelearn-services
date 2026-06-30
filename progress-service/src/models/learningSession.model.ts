/**
 * Tác dụng và mục đích:
 * Dùng để quản lý các phiên học tập chi tiết của học viên khi tham gia học một bài học cụ thể.
 * Ghi nhận các thông tin như thời gian bắt đầu phiên, thời điểm cập nhật heartbeat cuối cùng,
 * tổng thời gian học thực tế trong phiên (giây hoạt động), thiết bị sử dụng và trạng thái phiên học (đang học hoặc đã kết thúc).
 * Hỗ trợ theo dõi tính liên tục và xác thực thời gian học của học viên để tránh gian lận.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { LessonProgressType } from './lessonProgress.model';

export enum LearningSessionStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export interface ILearningSession extends Document {
  sessionId: string;
  userId: string;
  courseId: string;
  courseVersionId: string;
  lessonId: string;
  lessonType: LessonProgressType;
  authSessionId?: string;
  clientInstanceId?: string;
  videoAssetId?: string;
  leaseVersion?: number;
  startedAt: Date;
  lastHeartbeatAt: Date;
  endedAt?: Date | null;
  revokedAt?: Date | null;
  revokeReason?: string;
  heartbeatCount: number;
  activeSeconds: number;
  deviceInfo?: string;
  status: LearningSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const learningSessionSchema = new Schema<ILearningSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    courseVersionId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    lessonType: { type: String, enum: Object.values(LessonProgressType), required: true },
    authSessionId: { type: String, default: '', index: true },
    clientInstanceId: { type: String, default: '' },
    videoAssetId: { type: String, default: '' },
    leaseVersion: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: Date.now },
    lastHeartbeatAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: '' },
    heartbeatCount: { type: Number, default: 0, min: 0 },
    activeSeconds: { type: Number, default: 0, min: 0 },
    deviceInfo: { type: String, default: '' },
    status: {
      type: String,
      enum: Object.values(LearningSessionStatus),
      default: LearningSessionStatus.ACTIVE,
      index: true,
    },
  },
  { timestamps: true }
);

learningSessionSchema.index({ userId: 1, courseId: 1, lessonId: 1 });
learningSessionSchema.index({ userId: 1, status: 1, lastHeartbeatAt: -1 });

export const LearningSession = mongoose.model<ILearningSession>('LearningSession', learningSessionSchema);
