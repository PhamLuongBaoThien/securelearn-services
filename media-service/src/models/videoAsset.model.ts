// - là nguồn dữ liệu chuẩn cho trạng thái upload và xử lý video của media-service
// - quản lý các file video bài học
import mongoose, { Document, Schema } from 'mongoose';

export enum VideoAssetStatus {
  INITIATED  = 'INITIATED',
  UPLOADING  = 'UPLOADING',
  UPLOADED   = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  READY      = 'READY',
  FAILED     = 'FAILED',
}

export interface IVideoAssetRendition {
  quality: string;
  width: number;
  height: number;
  bandwidth: number;
  manifestKey: string;
  playlistPath: string;
}

export interface IVideoAsset extends Document {
  ownerUserId: string;
  courseId: string;
  lessonId: string;
  originalFileName: string;
  mimeType: string;
  durationSec: number;
  rawObjectKey: string;
  manifestKey: string;
  masterManifestKey?: string | null;
  multipartUploadId?: string | null;
  uploadCompletedAt?: Date | null;
  sourceSizeBytes: number;
  encryptionKey?: string | null;
  processingProgress: number;
  status: VideoAssetStatus;
  isAttached: boolean;
  errorMessage?: string | null;
  availableQualities: string[];
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  renditions: IVideoAssetRendition[];
  createdAt: Date;
  updatedAt: Date;
}

const renditionSchema = new Schema<IVideoAssetRendition>(
  {
    quality: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bandwidth: { type: Number, required: true },
    manifestKey: { type: String, required: true },
    playlistPath: { type: String, required: true },
  },
  { _id: false },
);

const videoAssetSchema = new Schema<IVideoAsset>(
  {
    ownerUserId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    originalFileName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    durationSec: { type: Number, default: 0 },
    rawObjectKey: { type: String, default: '' },
    manifestKey: { type: String, default: '' },
    masterManifestKey: { type: String, default: null },
    multipartUploadId: { type: String, default: null },
    uploadCompletedAt: { type: Date, default: null },
    sourceSizeBytes: { type: Number, default: 0 },
    encryptionKey: { type: String, default: null },
    processingProgress: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: Object.values(VideoAssetStatus), default: VideoAssetStatus.INITIATED, index: true },
    isAttached: { type: Boolean, default: false, index: true },
    errorMessage: { type: String, default: null },
    availableQualities: { type: [String], default: [] },
    sourceWidth: { type: Number, default: null },
    sourceHeight: { type: Number, default: null },
    renditions: { type: [renditionSchema], default: [] },
  },
  { timestamps: true },
);

export const VideoAsset = mongoose.model<IVideoAsset>('VideoAsset', videoAssetSchema);
