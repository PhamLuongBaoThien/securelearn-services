// File này chứa model Lesson.
// Đây là model trung tâm của curriculum vì mỗi lesson sẽ trỏ sang video/document/quiz tùy type.
import mongoose, { Document, Schema, Types } from 'mongoose';

export enum LessonType {
  VIDEO = 'VIDEO',
  DOCUMENT = 'DOCUMENT',
  QUIZ = 'QUIZ',
}

export enum LessonStatus {
  DRAFT = 'DRAFT', // Đang soạn thảo
  PROCESSING = 'PROCESSING', // Đang xử lý
  READY = 'READY',
  FAILED = 'FAILED',
}

export interface ILesson extends Document {
  courseId: Types.ObjectId;
  sectionId: Types.ObjectId;
  title: string;
  type: LessonType;
  status: LessonStatus;
  summary: string; // Giống description ở course
  duration: number; // Thời lượng bài học (video/document/quiz)
  order: number; // Thứ tự bài học trong section
  isFreePreview: boolean; // Nếu true thì student không cần trả phí để xem lesson này
  videoAssetId?: Types.ObjectId | null;
  documentAssetId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const lessonSchema = new Schema<ILesson>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: Object.values(LessonType), default: LessonType.VIDEO },
    status: { type: String, enum: Object.values(LessonStatus), default: LessonStatus.DRAFT, index: true },
    summary: { type: String, default: '', trim: true },
    duration: { type: Number, default: 0 }, // duration là thời lượng của bài học , = 0 nếu type là quiz hoặc document
    order: { type: Number, required: true },
    isFreePreview: { type: Boolean, default: false },
    videoAssetId: { type: Schema.Types.ObjectId, default: null, index: true }, // index: true -> Tối ưu tìm kiếm theo videoAssetId
    documentAssetId: { type: Schema.Types.ObjectId, default: null, index: true }, // index: true -> Tối ưu tìm kiếm theo documentAssetId
  },
  {
    timestamps: true,
  }
);

lessonSchema.index({ sectionId: 1, order: 1 }, { unique: true });
lessonSchema.index({ courseId: 1 });

export const Lesson = mongoose.model<ILesson>('Lesson', lessonSchema);
