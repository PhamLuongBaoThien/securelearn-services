// - quản lý danh sách khóa học mong muốn của user
// - lưu các khóa học user muốn quay lại mua sau
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IWishlistItem {
  courseId: Types.ObjectId;
  addedAt: Date;
}

export interface IWishlist extends Document {
  userId: string;
  items: IWishlistItem[];
  createdAt: Date;
  updatedAt: Date;
}

const wishlistItemSchema = new Schema<IWishlistItem>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const wishlistSchema = new Schema<IWishlist>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: { type: [wishlistItemSchema], default: [] },
  },
  { timestamps: true }
);

wishlistSchema.index({ userId: 1, 'items.courseId': 1 });

export const Wishlist = mongoose.model<IWishlist>('Wishlist', wishlistSchema);
