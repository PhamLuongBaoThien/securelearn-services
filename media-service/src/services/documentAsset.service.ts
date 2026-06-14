// File này chứa flow upload document asset (tài liệu đính kèm).
// Không có bước xử lý hậu kỳ — upload xong là đánh READY ngay.
// isAttached dùng cho orphan cleanup job (lọc asset chưa được bind vào bài học).
import fs from 'fs';
import path from 'path';
import { DocumentAsset, DocumentAssetStatus } from '../models/documentAsset.model';
import s3Service from './s3.service';

const ORPHAN_TTL_MS = Number(process.env.MEDIA_ORPHAN_TTL_MS || 30 * 60 * 1000);
const MAX_SAFE_FILE_NAME_LENGTH = 180;

const sanitizeFileName = (fileName: string): string => {
  const safeName = fileName
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName.slice(0, MAX_SAFE_FILE_NAME_LENGTH);
};

class DocumentAssetService {
  // Flow document upload:
  // 1. Multer nhận file tạm ở tmp-media/incoming.
  // 2. Service sanitize tên file, upload lên storage.
  // 3. Xóa file tạm local và tạo asset READY.
  public async uploadDocument(
    data: { ownerUserId: string; courseId: string; lessonId: string },
    file: Express.Multer.File
  ) {
    const originalFileName = sanitizeFileName(file.originalname || 'document');
    const objectKey = path.posix.join(
      'courses',
      data.courseId,
      'lessons',
      data.lessonId,
      'documents',
      `${Date.now()}_${originalFileName}`,
    );

    try {
      await s3Service.uploadFile(file.path, objectKey, file.mimetype);
    } finally {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    const asset = await DocumentAsset.create({
      ownerUserId: data.ownerUserId,
      courseId: data.courseId,
      lessonId: data.lessonId,
      originalFileName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      pageCount: 0,
      objectKey,
      filePath: s3Service.getFileUrl(objectKey),
      status: DocumentAssetStatus.READY,
      isAttached: false,
    });

    return asset;
  }

  public async getAsset(documentAssetId: string) {
    const asset = await DocumentAsset.findById(documentAssetId).lean();
    if (!asset) throw new Error('Document asset không tồn tại.');
    return asset;
  }

  public async getBindingSnapshot(documentAssetId: string) {
    const asset = await DocumentAsset.findById(documentAssetId)
      .select('_id ownerUserId courseId lessonId status isAttached')
      .lean();
    if (!asset) return null;
    return {
      assetId: asset._id.toString(),
      ownerUserId: asset.ownerUserId,
      courseId: asset.courseId,
      lessonId: asset.lessonId,
      status: asset.status,
      isAttached: asset.isAttached,
    };
  }

  public async markAssetAttached(documentAssetId: string): Promise<void> {
    await DocumentAsset.updateOne(
      { _id: documentAssetId },
      {
        $set: {
          isAttached: true,
        },
      }
    );
  }

  /**
   * Xoá document asset hoàn toàn: file trên S3 + record trong DB.
   * Gọi từ RabbitMQ cleanup event khi course-service gỡ attachment khỏi lesson.
   */
  public async deleteAsset(documentAssetId: string): Promise<void> {
    const asset = await DocumentAsset.findById(documentAssetId);
    if (!asset) return; // idempotent — đã xoá rồi thì bỏ qua

    try {
      // Xoá file trên S3
      if (asset.objectKey) {
        await s3Service.deleteFile(asset.objectKey).catch(() => {});
      }
    } catch (error) {
      console.error(`[DocumentAssetService] Lỗi khi xoá file vật lý cho asset ${documentAssetId}:`, error);
    }

    // Luôn xoá record DB dù xoá file có lỗi hay không
    await DocumentAsset.deleteOne({ _id: documentAssetId });
    console.log(`[DocumentAssetService] Đã xoá document asset ${documentAssetId}`);
  }

  public startOrphanCleanupJob(): void {
    setInterval(() => {
      void this.cleanupOrphanedAssets();
    }, ORPHAN_TTL_MS);
  }

  private async cleanupOrphanedAssets(): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_TTL_MS);
    const staleAssets = await DocumentAsset.find({
      isAttached: false,
      updatedAt: { $lt: cutoff },
      status: { $in: [DocumentAssetStatus.INITIATED, DocumentAssetStatus.READY, DocumentAssetStatus.FAILED] },
    })
      .select('_id')
      .lean();

    for (const asset of staleAssets) {
      console.log(`[DocumentAssetService] Dọn document asset mồ côi ${asset._id.toString()}`);
      await this.deleteAsset(asset._id.toString());
    }
  }
}

export default new DocumentAssetService();
