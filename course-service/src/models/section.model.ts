// - là cấu trúc chứa và nhóm các bài học (lesson) lại với nhau trong một phiên bản khóa học
// - giúp tổ chức nội dung khóa học theo từng phần mạch lạc
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISection extends Document {
  courseId: Types.ObjectId;
  title: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const sectionSchema = new Schema<ISection>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'CourseVersion', required: true, index: true },
    title: { type: String, required: true, trim: true },
    order: { type: Number, required: true },
  },
  {
    timestamps: true,
  }
);

sectionSchema.index({ courseId: 1, order: 1 }, { unique: true });

export const Section = mongoose.model<ISection>('Section', sectionSchema);
