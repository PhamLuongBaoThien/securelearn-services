// File này chứa flow upload document asset (tài liệu đính kèm).
// Không có bước xử lý hậu kỳ — upload xong là đánh READY ngay.
// isAttached dùng cho orphan cleanup job (lọc asset chưa được bind vào bài học).
import fs from 'fs';
import path from 'path';
import { DocumentAsset, DocumentAssetStatus } from '../models/documentAsset.model';
import s3Service from './s3.service';

const ORPHAN_TTL_MS = Number(process.env.MEDIA_ORPHAN_TTL_MS || 30 * 60 * 1000);
const MAX_SAFE_FILE_NAME_LENGTH = 180;

/** Loại bỏ ký tự đường dẫn/điều khiển trước khi đưa tên tệp vào Object Key trên R2. */
const sanitizeFileName = (fileName: string): string => {
  const safeName = fileName
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName.slice(0, MAX_SAFE_FILE_NAME_LENGTH);
};

class DocumentAssetService {
  /**
   * Tải tài liệu lên R2 theo flow một bước:
   * Multer lưu tệp tạm, service chuẩn hóa tên và PutObject lên R2, xóa tệp tạm,
   * sau đó tạo DocumentAsset ở trạng thái READY.
   */
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

  /** Đọc đầy đủ metadata và trạng thái của DocumentAsset từ MongoDB. */
  public async getAsset(documentAssetId: string) {
    const asset = await DocumentAsset.findById(documentAssetId).lean();
    if (!asset) throw new Error('Document asset không tồn tại.');
    return asset;
  }

  /** Trả metadata tối thiểu để Course Service xác minh tài liệu trước khi gắn vào bài học. */
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

  /** Đánh dấu tài liệu đã được gắn vào bài học để job dọn dữ liệu không xóa nhầm. */
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
   * Xóa document asset hoàn toàn: object trên R2 và bản ghi trong MongoDB.
   * Gọi từ RabbitMQ cleanup event khi course-service gỡ attachment khỏi lesson.
   */
  public async deleteAsset(documentAssetId: string): Promise<void> {
    const asset = await DocumentAsset.findById(documentAssetId);
    if (!asset) return; // idempotent — đã xoá rồi thì bỏ qua

    try {
      // Xóa object trên R2 thông qua Amazon S3 API.
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

  /** Khởi động lịch dọn các tài liệu tải lên nhưng không được gắn vào bài học sau thời gian TTL. */
  public startOrphanCleanupJob(): void {
    setInterval(() => {
      void this.cleanupOrphanedAssets();
    }, ORPHAN_TTL_MS);
  }

  /** Tìm DocumentAsset quá hạn còn isAttached=false và xóa dữ liệu trên R2/MongoDB. */
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
