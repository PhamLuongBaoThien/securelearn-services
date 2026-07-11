import { Document, Schema, model } from 'mongoose';

export interface IPolicy extends Document {
  title: string;
  slug: string;
  summary: string;
  content: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const policySchema = new Schema<IPolicy>({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 180, unique: true },
  summary: { type: String, trim: true, maxlength: 300, default: '' },
  content: { type: String, required: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false });

policySchema.index({ isActive: 1, updatedAt: -1 });
policySchema.index({ title: 'text', summary: 'text', content: 'text' });

export default model<IPolicy>('Policy', policySchema);
