// File này chứa model VideoAsset.
// Asset này là nguồn sự thật cho trạng thái upload/xử lý video bên media-service.
import mongoose, { Document, Schema } from 'mongoose';

export enum VideoAssetStatus {
  INITIATED  = 'INITIATED',   // Asset vừa được tạo, chưa upload
  UPLOADING  = 'UPLOADING',   // Đang upload multipart lên storage
  UPLOADED   = 'UPLOADED',    // Upload xong storage, chờ FFmpeg xử lý
  PROCESSING = 'PROCESSING',  // FFmpeg đang encode HLS
  READY      = 'READY',       // Hoàn tất, sẵn sàng phát
  FAILED     = 'FAILED',      // Thất bại
}

export interface IVideoAsset extends Document {
  ownerUserId: string; // id của user sở hữu video
  courseId: string; // id của course mà video này thuộc về
  lessonId: string; // id của lesson mà video này thuộc về
  originalFileName: string; // tên file gốc
  mimeType: string; // loại file
  durationSec: number; // thời lượng video
  rawObjectKey: string; // khóa object logical của file gốc
  manifestKey: string; // khóa object logical của manifest HLS
  multipartUploadId?: string | null;  // S3 Multipart UploadId (null khi đã complete/abort)
  uploadCompletedAt?: Date | null;     // Thời điểm storage confirm upload xong
  sourceSizeBytes: number;             // Kích thước file gốc FE báo lên (bytes)
  encryptionKey?: string | null;       // Khoá AES-128
  processingProgress: number; // tiến độ xử lý
  status: VideoAssetStatus;
  isAttached: boolean;
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
    mimeType: { type: String, default: '' }, // mimiType là
    durationSec: { type: Number, default: 0 },
    rawObjectKey: { type: String, default: '' },
    manifestKey: { type: String, default: '' },
    multipartUploadId: { type: String, default: null },
    uploadCompletedAt: { type: Date, default: null },
    sourceSizeBytes: { type: Number, default: 0 },
    encryptionKey: { type: String, default: null }, // Khoá AES-128 dạng Hex
    processingProgress: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: Object.values(VideoAssetStatus), default: VideoAssetStatus.INITIATED, index: true },
    isAttached: { type: Boolean, default: false, index: true },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

export const VideoAsset = mongoose.model<IVideoAsset>('VideoAsset', videoAssetSchema);
