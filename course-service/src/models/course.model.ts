// ========================
// File này chứa model Course.
// Course chỉ giữ metadata + số liệu tổng hợp.
// Curriculum thật đã được tách sang Section và Lesson collections riêng.
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
  totalDuration: number;
  totalLessons: number;
  totalSections: number;
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ===== Schema =====

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
    totalDuration: { type: Number, default: 0 },
    totalLessons: { type: Number, default: 0 },
    totalSections: { type: Number, default: 0 },
    enrollmentCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Slug được tạo từ title + _id để giảm khả năng trùng.
courseSchema.pre('save', function (next) {
  if (this.isModified('title')) {
    this.slug = slugify(this.title, { lower: true, strict: true }) + '-' + this._id;
  }

  next();
});

export const Course = mongoose.model<ICourse>('Course', courseSchema);
