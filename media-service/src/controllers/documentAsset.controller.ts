// File này là controller cho document asset.
// Flow: upload 1 bước, query trạng thái.
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import documentAssetService from '../services/documentAsset.service';
import s3Service from '../services/s3.service';

/** Ẩn Object Key và URL nội bộ khỏi response nếu người gọi không phải chủ sở hữu hoặc quản trị viên. */
const sanitizeDocumentAsset = (asset: Awaited<ReturnType<typeof documentAssetService.getAsset>>, requester?: { userId?: string; role?: string }) => {
  const { objectKey: _hiddenObjectKey, filePath: _hiddenFilePath, ...safeAsset } = asset;
  if (requester?.role === 'ADMIN' || asset.ownerUserId === requester?.userId) {
    return { ...safeAsset, filePath: asset.filePath };
  }
  return safeAsset;
};

/** Chỉ cho phép trình duyệt xem trực tiếp PDF và hình ảnh; định dạng khác phải tải xuống. */
const isInlineViewableMimeType = (mimeType: string) =>
  mimeType === 'application/pdf' || mimeType.startsWith('image/');

class DocumentAssetController {
  /** Nhận tệp từ Multer và chuyển sang DocumentAssetService để lưu trên R2. */
  public async uploadDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng tải tài liệu.' });
        return;
      }

      const asset = await documentAssetService.uploadDocument(
        {
          ownerUserId: req.userId!,
          courseId: req.body.courseId,
          lessonId: req.body.lessonId,
        },
        req.file
      );

      res.status(201).json({ status: 'OK', message: 'Tải tài liệu thành công.', data: asset });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /** Trả metadata an toàn của tài liệu để Frontend theo dõi và hiển thị trạng thái. */
  public async getAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const asset = await documentAssetService.getAsset(req.params.documentAssetId as string);
      res.status(200).json({
        status: 'OK',
        data: sanitizeDocumentAsset(asset, { userId: req.userId, role: req.userRole }),
      });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  /** Đọc stream PDF/hình ảnh từ R2 và chuyển tiếp với Content-Disposition=inline. */
  public async viewDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      const documentAssetId = req.params.documentAssetId as string;
      const asset = await documentAssetService.getAsset(documentAssetId);
      if (!asset.objectKey || asset.status !== 'READY') {
        res.status(404).send('Document not found or not ready');
        return;
      }
      if (!isInlineViewableMimeType(asset.mimeType || '')) {
        res.status(415).send('Inline preview only supports PDF or image files');
        return;
      }

      const stream = await s3Service.getObjectStream(asset.objectKey);
      const fallbackName = asset.mimeType === 'application/pdf' ? 'document.pdf' : 'document';
      res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asset.originalFileName || fallbackName)}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      stream.pipe(res);
    } catch (error: any) {
      res.status(404).send('Document not found');
    }
  }

  /** Đọc stream tài liệu từ R2 và chuyển tiếp dưới dạng tệp tải xuống. */
  public async downloadDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      const documentAssetId = req.params.documentAssetId as string;
      const asset = await documentAssetService.getAsset(documentAssetId);
      if (!asset.objectKey || asset.status !== 'READY') {
        res.status(404).send('Document not found or not ready');
        return;
      }

      const stream = await s3Service.getObjectStream(asset.objectKey);
      res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(asset.originalFileName || 'document')}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      stream.pipe(res);
    } catch (error: any) {
      res.status(404).send('Document not found');
    }
  }
}

export default new DocumentAssetController();
