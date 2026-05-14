// File này chứa model DocumentAsset.
// Asset này lưu metadata file tài liệu đã upload cho lesson type DOCUMENT.
import mongoose, { Document, Schema } from 'mongoose';

export enum DocumentAssetStatus {
  INITIATED = 'INITIATED',
  READY = 'READY',
  FAILED = 'FAILED',
}

export interface IDocumentAsset extends Document {
  ownerUserId: string;
  courseId: string;
  lessonId: string;
  originalFileName: string;       // Tên file gốc khi upload
  mimeType: string;               // Loại file
  sizeBytes: number;              // Kích thước file
  pageCount: number;              // Số trang
  objectKey: string;              // Khóa object logical của tài liệu
  filePath: string;               // Đường dẫn file
  status: DocumentAssetStatus;    // Trạng thái file
  isAttached: boolean;
  attachedLessonId?: string | null;
  attachedAt?: Date | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const documentAssetSchema = new Schema<IDocumentAsset>(
  {
    ownerUserId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    originalFileName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0 },
    pageCount: { type: Number, default: 0 },
    objectKey: { type: String, default: '' },
    filePath: { type: String, default: '' },
    status: { type: String, enum: Object.values(DocumentAssetStatus), default: DocumentAssetStatus.INITIATED, index: true },
    isAttached: { type: Boolean, default: false, index: true },
    attachedLessonId: { type: String, default: null, index: true },
    attachedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

export const DocumentAsset = mongoose.model<IDocumentAsset>('DocumentAsset', documentAssetSchema);
