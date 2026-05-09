// File này chứa model Category.
// Category được dùng để gắn metadata cho course và dựng cây danh mục cho editor/public.
import mongoose, { Document, Schema } from 'mongoose';
import slugify from 'slugify';

export interface ICategory extends Document {
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  parentId?: mongoose.Types.ObjectId | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 }, 
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    createdBy: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

// Tên danh mục chỉ cần unique trong cùng cấp, nhưng slug phải unique toàn cục
// vì public URL/filter hiện đang resolve category chỉ bằng slug.
categorySchema.index({ name: 1, parentId: 1 }, { unique: true });

categorySchema.pre('validate', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true, trim: true });
  }

  next();
});

// Bắt lỗi MongoDB E11000 và trả thông báo thân thiện
categorySchema.post('save', function (_error: any, _doc: any, next: any) {
  if (_error.name === 'MongoServerError' && _error.code === 11000) {
    const field = Object.keys(_error.keyPattern || {})[0];
    if (field === 'name') {
      next(new Error('Tên danh mục đã tồn tại trong cùng cấp. Vui lòng chọn tên khác.'));
    } else if (field === 'slug') {
      next(new Error('Slug URL đã tồn tại. Vui lòng đổi tên danh mục.'));
    } else {
      next(new Error('Dữ liệu bị trùng lặp. Vui lòng kiểm tra lại.'));
    }
  } else {
    next(_error);
  }
});

export const Category = mongoose.model<ICategory>('Category', categorySchema);
