// File này chứa model Lesson.
// Đây là model trung tâm của curriculum vì mỗi lesson sẽ trỏ sang video/quiz tùy type.
// Tài liệu đính kèm (attachments) được lưu trong mảng attachments[] — áp dụng cho cả VIDEO lẫn QUIZ.
import mongoose, { Document, Schema, Types } from 'mongoose';

export enum LessonType {
  VIDEO = 'VIDEO',
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
  content: string; // Mô tả chi tiết (rich text HTML)
  duration: number; // Thời lượng bài học (video/quiz)
  order: number; // Thứ tự bài học trong section
  isFreePreview: boolean; // Nếu true thì student không cần trả phí để xem lesson này
  videoAssetId?: Types.ObjectId | null;
  attachments: Types.ObjectId[]; // Danh sách tài liệu đính kèm — áp dụng cho cả VIDEO lẫn QUIZ
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
    content: { type: String, default: '' },
    duration: { type: Number, default: 0 }, // duration = 0 nếu type là QUIZ
    order: { type: Number, required: true },
    isFreePreview: { type: Boolean, default: false },
    videoAssetId: { type: Schema.Types.ObjectId, default: null, index: true },
    attachments: { type: [Schema.Types.ObjectId], default: [] }, // Tài liệu đính kèm (có thể có nhiều)
  },
  {
    timestamps: true,
  }
);

lessonSchema.index({ sectionId: 1, order: 1 }, { unique: true });
lessonSchema.index({ courseId: 1 });

export const Lesson = mongoose.model<ILesson>('Lesson', lessonSchema);
