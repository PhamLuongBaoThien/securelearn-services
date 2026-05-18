// File này chứa flow upload document asset (tài liệu đính kèm).
// Không có bước xử lý hậu kỳ — upload xong là đánh READY ngay.
// isAttached dùng cho orphan cleanup job (lọc asset chưa được bind vào bài học).
import fs from 'fs';
import path from 'path';
import { DocumentAsset, DocumentAssetStatus } from '../models/documentAsset.model';
import s3Service from './s3.service';

const MEDIA_ROOT = path.resolve(process.cwd(), 'tmp-media');
const ORPHAN_TTL_MS = Number(process.env.MEDIA_ORPHAN_TTL_MS || 30 * 60 * 1000);

class DocumentAssetService {
  // Upload document một bước: đẩy file lên S3 và tạo asset READY.
  public async uploadDocument(
    data: { ownerUserId: string; courseId: string; lessonId: string },
    file: Express.Multer.File
  ) {
    const objectKey = path.posix.join('courses', data.courseId, 'lessons', data.lessonId, 'documents', Date.now() + '_' + file.originalname);
    
    // Upload thẳng lên S3/MinIO từ file tạm
    await s3Service.uploadFile(file.path, objectKey, file.mimetype);
    
    // Xóa file tạm
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    const asset = await DocumentAsset.create({
      ownerUserId: data.ownerUserId,
      courseId: data.courseId,
      lessonId: data.lessonId,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      pageCount: 0,
      objectKey,
      filePath: s3Service.getFileUrl(objectKey), // Lưu URL thay vì local path
      status: DocumentAssetStatus.READY,
      isAttached: false,
      attachedLessonId: null,
      attachedAt: null,
    });

    return asset;
  }

  public async getAsset(documentAssetId: string) {
    const asset = await DocumentAsset.findById(documentAssetId).lean();
    if (!asset) throw new Error('Document asset không tồn tại.');
    return asset;
  }

  public async markAssetAttached(documentAssetId: string, lessonId: string): Promise<void> {
    await DocumentAsset.updateOne(
      { _id: documentAssetId },
      {
        $set: {
          isAttached: true,
          attachedLessonId: lessonId,
          attachedAt: new Date(),
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
