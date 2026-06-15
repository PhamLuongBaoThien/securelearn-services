// - lưu thông tin tổng quan của một khóa học (tiêu đề, mô tả, giá, giảng viên)
// - quản lý trạng thái hiển thị và luồng xét duyệt khóa học
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
  PENDING = 'PENDING', // Chờ admin duyệt
  PUBLISHED = 'PUBLISHED', // Công khai
  REJECTED = 'REJECTED', // Admin yêu cầu chỉnh sửa, giảng viên có thể sửa và gửi lại
  ARCHIVED = 'ARCHIVED', // Version cũ đã được thay thế, chỉ giữ để audit
}

export enum CategoryResolutionStatus {
  NONE = 'NONE',
  NEEDS_ADMIN_CLASSIFICATION = 'NEEDS_ADMIN_CLASSIFICATION',
}

export enum SubscriptionCatalogStatus {
  NOT_OPTED_IN = 'NOT_OPTED_IN',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REMOVED = 'REMOVED',
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
  categoryResolutionStatus: CategoryResolutionStatus;
  suggestedCategoryName: string;
  suggestedCategoryNote: string;
  level: CourseLevel;
  status: CourseStatus;
  currentVersionId?: Types.ObjectId | null; // CourseVersion đang public cho học viên/catalog
  draftVersionId?: Types.ObjectId | null;   // CourseVersion giảng viên đang sửa hoặc chờ duyệt
  price: number;
  totalDuration: number;
  totalLessons: number;
  totalSections: number;
  enrollmentCount: number;
  subscriptionStatus: SubscriptionCatalogStatus;
  subscriptionReviewReason: string;
  subscriptionReviewedAt?: Date | null;
  subscriptionReviewedBy: string;
  subscriptionReviewedByName: string;
  subscriptionReviewedByEmail: string;
  subscriptionReviewHistory: Array<{
    action: 'APPROVE' | 'REJECT' | 'REMOVE' | 'WITHDRAW';
    actorId: string;
    actorRole: 'ADMIN' | 'INSTRUCTOR';
    actorName: string;
    actorEmail: string;
    reason: string;
    reviewedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

// ===== Schema =====

const subscriptionReviewHistorySchema = new Schema(
  {
    action: { type: String, enum: ['APPROVE', 'REJECT', 'REMOVE', 'WITHDRAW'], required: true },
    actorId: { type: String, required: true },
    actorRole: { type: String, enum: ['ADMIN', 'INSTRUCTOR'], required: true },
    actorName: { type: String, default: '' },
    actorEmail: { type: String, default: '' },
    reason: { type: String, default: '' },
    reviewedAt: { type: Date, required: true },
  },
  { _id: false }
);

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
    currentVersionId: { type: Schema.Types.ObjectId, ref: 'CourseVersion', default: null, index: true },
    draftVersionId: { type: Schema.Types.ObjectId, ref: 'CourseVersion', default: null, index: true },
    price: { type: Number, default: 0, min: 0 },
    totalDuration: { type: Number, default: 0 },
    totalLessons: { type: Number, default: 0 },
    totalSections: { type: Number, default: 0 },
    enrollmentCount: { type: Number, default: 0 },
    // Trạng thái này quyết định course có được xuất hiện trong catalog thuê bao hay không.
    subscriptionStatus: {
      type: String,
      enum: Object.values(SubscriptionCatalogStatus),
      default: SubscriptionCatalogStatus.NOT_OPTED_IN,
      index: true,
    },
    subscriptionReviewReason: { type: String, default: '' },
    subscriptionReviewedAt: { type: Date, default: null },
    subscriptionReviewedBy: { type: String, default: '' },
    subscriptionReviewedByName: { type: String, default: '' },
    subscriptionReviewedByEmail: { type: String, default: '' },
    subscriptionReviewHistory: { type: [subscriptionReviewHistorySchema], default: [] },
  },
  {
    timestamps: true,
  }
);

courseSchema.index({ instructorId: 1, status: 1 });

// Slug được tạo từ title khi title thay đổi.
// Nếu slug đã tồn tại thì thêm hậu tố số (-2, -3, ...) cho đến khi tìm được slug chưa dùng.
// Ví dụ: "React Cơ Bản" → react-co-ban → (nếu trùng) react-co-ban-2 → ...
courseSchema.pre('save', async function (next) {
  if (this.isModified('title')) {
    const base = slugify(this.title, { lower: true, strict: true });
    let candidate = base;
    let counter = 2;

    // Kiểm tra slug candidate đã tồn tại chưa (loại trừ chính document này).
    // eslint-disable-next-line no-await-in-loop
    while (await Course.findOne({ slug: candidate, _id: { $ne: this._id } })) {
      candidate = `${base}-${counter}`;
      counter++;
    }

    this.slug = candidate;
  }

  next();
});

export const Course = mongoose.model<ICourse>('Course', courseSchema);
