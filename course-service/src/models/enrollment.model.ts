// ========================
// File này chứa model Enrollment.
// Đây là lớp nối user với course ở phía học tập/ghi danh.
// ========================
import mongoose, { Schema, Document, Types } from 'mongoose';

export enum EnrollmentStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum EnrollmentSource {
  PURCHASE = 'PURCHASE',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

export interface IEnrollment extends Document {
  userId: string;            // ID học viên (từ Identity Service)
  courseId: Types.ObjectId;   // Ref đến Course
  status: EnrollmentStatus;
  enrolledAt: Date;
  source: EnrollmentSource;
  subscriptionTermId?: string;
  accessEndsAt?: Date;
}

const enrollmentSchema = new Schema<IEnrollment>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    status: {
      type: String,
      enum: Object.values(EnrollmentStatus),
      default: EnrollmentStatus.ACTIVE,
    },
    enrolledAt: { type: Date, default: Date.now },
    // source giúp phân biệt quyền vĩnh viễn (PURCHASE) với quyền theo kỳ hạn (SUBSCRIPTION).
    source: { type: String, enum: Object.values(EnrollmentSource), default: EnrollmentSource.PURCHASE, index: true },
    subscriptionTermId: { type: String, default: '', index: true },
    accessEndsAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Đảm bảo 1 user chỉ ghi danh 1 lần vào 1 khóa học
enrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const Enrollment = mongoose.model<IEnrollment>('Enrollment', enrollmentSchema);
