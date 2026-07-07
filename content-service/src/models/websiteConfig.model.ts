import { Document, Schema, model } from 'mongoose';

export interface IWebsiteConfig extends Document {
  siteUrl: string;
  logoUrl: string;
  logoPublicId?: string;
  faviconUrl: string;
  faviconPublicId?: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  facebookUrl?: string;
  youtubeUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const websiteConfigSchema = new Schema<IWebsiteConfig>({
  siteUrl: { type: String, trim: true, default: 'https://securelearn.vn' },
  logoUrl: { type: String, trim: true, default: '' },
  logoPublicId: { type: String, trim: true },
  faviconUrl: { type: String, trim: true, default: '/favicon.svg' },
  faviconPublicId: { type: String, trim: true },
  contactEmail: { type: String, trim: true, default: 'plbthien2004@gmail.com' },
  contactPhone: { type: String, trim: true, default: '+84 343613222' },
  address: { type: String, trim: true, default: '' },
  facebookUrl: { type: String, trim: true },
  youtubeUrl: { type: String, trim: true },
  githubUrl: { type: String, trim: true },
  linkedinUrl: { type: String, trim: true },
}, { timestamps: true, versionKey: false });

export default model<IWebsiteConfig>('WebsiteConfig', websiteConfigSchema);
