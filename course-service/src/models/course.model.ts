// ========================
// Model: Course — Khóa học với cấu trúc Sections > Lessons
// Sử dụng nested documents (MongoDB) cho cấu trúc giáo trình linh hoạt
// ========================
import mongoose, { Schema, Document, Types } from 'mongoose';
import slugify from 'slugify';

// ===== Enums =====

export enum CourseLevel {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
}

export enum CourseStatus {
  DRAFT = 'DRAFT', // Nháp
  PUBLISHED = 'PUBLISHED', // Công khai
  ARCHIVED = 'ARCHIVED', // Lưu trữ
}

export enum LessonType {
  VIDEO = 'VIDEO',
  DOCUMENT = 'DOCUMENT',
  QUIZ = 'QUIZ',
}

// ===== Interfaces =====

export interface ILesson {
  _id?: Types.ObjectId;
  title: string;
  type: LessonType;
  content: string;       // URL video hoặc nội dung document
  duration: number;       // Thời lượng (giây), 0 nếu không phải video
  order: number;          // Thứ tự bài học
  isFreePreview: boolean; // Cho xem miễn phí (không cần ghi danh)
}

export interface ISection {
  _id?: Types.ObjectId;
  title: string;
  order: number;
  lessons: ILesson[];
}

export interface ICourse extends Document {
  title: string;
  slug: string;
  shortDescription: string;   // Mô tả ngắn hiển thị dưới tên khóa học
  description: string;        // Mô tả chi tiết (rich text HTML)
  thumbnail: string;
  whatYouWillLearn: string[]; // Học viên sẽ học được gì
  requirements: string[];     // Điều kiện tiên quyết
  instructorId: string;       // userId từ Identity Service
  instructorName: string;     // Cache tên giảng viên (cập nhật qua event)
  categoryId?: Types.ObjectId | null;
  level: CourseLevel;
  status: CourseStatus;
  price: number;
  sections: ISection[];
  totalDuration: number;
  totalLessons: number;
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ===== Schema =====

const lessonSchema = new Schema<ILesson>({
  title: { type: String, required: true, trim: true },
  type: { type: String, enum: Object.values(LessonType), default: LessonType.VIDEO },
  content: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  order: { type: Number, required: true },
  isFreePreview: { type: Boolean, default: false },
});

const sectionSchema = new Schema<ISection>({
  title: { type: String, required: true, trim: true },
  order: { type: Number, required: true },
  lessons: [lessonSchema],
});

const courseSchema = new Schema<ICourse>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true },
    shortDescription: { type: String, default: '', maxlength: 220 },
    description: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    whatYouWillLearn: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    instructorId: { type: String, required: true, index: true },
    instructorName: { type: String, default: '' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    level: {
      type: String,
      enum: Object.values(CourseLevel),
      default: CourseLevel.BEGINNER,
    },
    status: {
      type: String,
      enum: Object.values(CourseStatus),
      default: CourseStatus.DRAFT,
    },
    price: { type: Number, default: 0, min: 0 },
    sections: [sectionSchema],
    totalDuration: { type: Number, default: 0 },
    totalLessons: { type: Number, default: 0 },
    enrollmentCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// ===== Middleware: Tự động tạo slug từ title trước khi save =====
courseSchema.pre('save', function (next) {
  if (this.isModified('title')) {
    this.slug = slugify(this.title, { lower: true, strict: true }) + '-' + this._id;
  }

  // Tính tổng totalDuration và totalLessons từ sections
  let totalDuration = 0;
  let totalLessons = 0;
  for (const section of this.sections) {
    totalLessons += section.lessons.length;
    for (const lesson of section.lessons) {
      totalDuration += lesson.duration || 0;
    }
  }
  this.totalDuration = totalDuration;
  this.totalLessons = totalLessons;

  next();
});

export const Course = mongoose.model<ICourse>('Course', courseSchema);
