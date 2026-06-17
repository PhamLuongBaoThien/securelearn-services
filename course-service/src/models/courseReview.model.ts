import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICourseReview extends Document {
  courseId: Types.ObjectId;
  userId: string;
  userName: string;
  userEmail: string;
  userAvatarUrl: string;
  rating: number;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

const courseReviewSchema = new Schema<ICourseReview>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: '' },
    userEmail: { type: String, default: '' },
    userAvatarUrl: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

courseReviewSchema.index({ courseId: 1, userId: 1 }, { unique: true });
courseReviewSchema.index({ courseId: 1, updatedAt: -1 });

export const CourseReview = mongoose.model<ICourseReview>('CourseReview', courseReviewSchema);
