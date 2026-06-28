import mongoose, { Document, Schema } from 'mongoose';

export interface IPublicProfileSlug extends Document {
  slug: string;
  userId: string;
  isCurrent: boolean;
  isTombstone: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const publicProfileSlugSchema = new Schema<IPublicProfileSlug>(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    userId: { type: String, required: true, index: true },
    isCurrent: { type: Boolean, default: true, index: true },
    isTombstone: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

publicProfileSlugSchema.index({ userId: 1, isCurrent: 1 });

export const PublicProfileSlug = mongoose.model<IPublicProfileSlug>('PublicProfileSlug', publicProfileSlugSchema);