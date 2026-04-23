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
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, trim: true, unique: true, index: true },
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

categorySchema.pre('validate', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true, trim: true });
  }

  next();
});

export const Category = mongoose.model<ICategory>('Category', categorySchema);
