import mongoose, { Document, Schema, Types } from 'mongoose';
import { CategoryResolutionStatus, CourseLevel, CourseStatus } from './course.model';
import slugify from 'slugify';

// CourseVersion là bản nội dung thật của khóa học.
// Course giữ id ổn định cho catalog/enrollment, còn Section/Lesson/Quiz trỏ vào CourseVersion.
export interface ICourseVersion extends Document {
  courseId: Types.ObjectId;
  versionNumber: number;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  thumbnail: string;
  whatYouWillLearn: string[];
  requirements: string[];
  instructorId: string;
  instructorName: string;
  categoryId?: Types.ObjectId | null;
  categoryResolutionStatus: CategoryResolutionStatus;
  suggestedCategoryName: string;
  suggestedCategoryNote: string;
  level: CourseLevel;
  status: CourseStatus;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedByEmail?: string;
  rejectionReason?: string;
  price: number;
  totalDuration: number;
  totalLessons: number;
  totalSections: number;
  createdAt: Date;
  updatedAt: Date;
}

const courseVersionSchema = new Schema<ICourseVersion>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    versionNumber: { type: Number, required: true, default: 1 },
    title: { type: String, required: true, trim: true },
    slug: { type: String, default: '', index: true },
    shortDescription: { type: String, default: '', maxlength: 220 },
    description: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    whatYouWillLearn: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    instructorId: { type: String, required: true, index: true },
    instructorName: { type: String, default: '' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    categoryResolutionStatus: {
      type: String,
      enum: Object.values(CategoryResolutionStatus),
      default: CategoryResolutionStatus.NONE,
      index: true,
    },
    suggestedCategoryName: { type: String, default: '', trim: true, maxlength: 120 },
    suggestedCategoryNote: { type: String, default: '', trim: true, maxlength: 500 },
    level: {
      type: String,
      enum: Object.values(CourseLevel),
      default: CourseLevel.BEGINNER,
    },
    status: {
      type: String,
      enum: Object.values(CourseStatus),
      default: CourseStatus.DRAFT,
      index: true,
    },
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: '' },
    reviewedByName: { type: String, default: '', trim: true },
    reviewedByEmail: { type: String, default: '', trim: true, lowercase: true },
    rejectionReason: { type: String, default: '' },
    price: { type: Number, default: 0, min: 0 },
    totalDuration: { type: Number, default: 0 },
    totalLessons: { type: Number, default: 0 },
    totalSections: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

courseVersionSchema.index({ courseId: 1, versionNumber: 1 }, { unique: true });
courseVersionSchema.index({ instructorId: 1, status: 1 });

// Slug của version được tạo từ title khi title thay đổi.
// Không yêu cầu unique (không có unique constraint), nhưng vẫn được generate đồng bộ với Course shell.
// Slug canonical dùng để routing public được lấy từ Course shell, không phải từ CourseVersion.
courseVersionSchema.pre('save', function (next) {
  if (this.isModified('title')) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }

  next();
});

export const CourseVersion = mongoose.model<ICourseVersion>('CourseVersion', courseVersionSchema);
