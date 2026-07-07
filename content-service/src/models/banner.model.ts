import { Document, Schema, model } from 'mongoose';

export interface IBanner extends Document {
  title: string;
  subtitle: string;
  imageUrl: string;
  imagePublicId?: string;
  linkUrl?: string;
  isActive: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const bannerSchema = new Schema<IBanner>({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  subtitle: { type: String, trim: true, maxlength: 240, default: '' },
  imageUrl: { type: String, required: true, trim: true },
  imagePublicId: { type: String, trim: true },
  linkUrl: { type: String, trim: true },
  isActive: { type: Boolean, default: true, index: true },
  order: { type: Number, required: true, min: 1, index: true },
}, { timestamps: true, versionKey: false });

bannerSchema.index({ isActive: 1, order: 1 });

export default model<IBanner>('Banner', bannerSchema);



