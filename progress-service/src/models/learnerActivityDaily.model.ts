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
