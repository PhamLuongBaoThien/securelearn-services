// File này chứa model VideoAsset.
// Asset này là nguồn sự thật cho trạng thái upload/xử lý video bên media-service.
import mongoose, { Document, Schema } from 'mongoose';

export enum VideoAssetStatus {
  INITIATED = 'INITIATED',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export interface IVideoAsset extends Document {
  ownerUserId: string; // id của user sở hữu video
  courseId: string; // id của course mà video này thuộc về
  lessonId: string; // id của lesson mà video này thuộc về
  originalFileName: string; // tên file gốc
  mimeType: string; // loại file
  sizeBytes: number; // kích thước file
  durationSec: number; // thời lượng video
  rawObjectKey: string; // khóa object logical của file gốc
  manifestKey: string; // khóa object logical của manifest HLS
  rawFilePath: string; // đường dẫn file gốc
  manifestPath: string; // đường dẫn file HLS manifest
  processingProgress: number; // tiến độ xử lý
  status: VideoAssetStatus;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const videoAssetSchema = new Schema<IVideoAsset>(
  {
    ownerUserId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    originalFileName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
    rawObjectKey: { type: String, default: '' },
    manifestKey: { type: String, default: '' },
    rawFilePath: { type: String, default: '' },
    manifestPath: { type: String, default: '' },
    processingProgress: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: Object.values(VideoAssetStatus), default: VideoAssetStatus.INITIATED, index: true },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

export const VideoAsset = mongoose.model<IVideoAsset>('VideoAsset', videoAssetSchema);
