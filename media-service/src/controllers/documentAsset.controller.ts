// File này là controller cho document asset.
// Flow: upload 1 bước, query trạng thái.
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import documentAssetService from '../services/documentAsset.service';
import documentViewAccessService from '../services/documentViewAccess.service';
import s3Service from '../services/s3.service';

const sanitizeDocumentAsset = (asset: Awaited<ReturnType<typeof documentAssetService.getAsset>>, requester?: { userId?: string; role?: string }) => {
  const { objectKey: _hiddenObjectKey, filePath: _hiddenFilePath, ...safeAsset } = asset;
  if (requester?.role === 'ADMIN' || asset.ownerUserId === requester?.userId) {
    return { ...safeAsset, filePath: asset.filePath };
  }
  return safeAsset;
};

const isInlineViewableMimeType = (mimeType: string) =>
  mimeType === 'application/pdf' || mimeType.startsWith('image/');

class DocumentAssetController {
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

  public async createViewSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const documentAssetId = req.params.documentAssetId as string;
      const asset = await documentAssetService.getAsset(documentAssetId);
      if (asset.status !== 'READY') {
        res.status(400).json({ status: 'ERR', message: 'Tài liệu chưa sẵn sàng để xem.' });
        return;
      }
      if (!isInlineViewableMimeType(asset.mimeType || '')) {
        res.status(400).json({ status: 'ERR', message: 'Chỉ tài liệu PDF hoặc hình ảnh mới hỗ trợ xem trực tiếp.' });
        return;
      }

      const token = await documentViewAccessService.createSession({
        userId: req.userId!,
        documentAssetId,
        mode: 'view',
      });

      res.status(201).json({
        status: 'OK',
        data: {
          asset: sanitizeDocumentAsset(asset, { userId: req.userId, role: req.userRole }),
          viewerUrl: `/api/media/documents/${documentAssetId}/view?token=${encodeURIComponent(token)}`,
          expiresIn: documentViewAccessService.ttlSeconds,
        },
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async viewDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      const documentAssetId = req.params.documentAssetId as string;
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) {
        res.status(400).send('Missing document view token');
        return;
      }

      const validSession = await documentViewAccessService.validateSession(token, req.userId!, documentAssetId, 'view');
      if (!validSession) {
        res.status(403).send('Invalid document view session');
        return;
      }

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

  public async createDownloadSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const documentAssetId = req.params.documentAssetId as string;
      const asset = await documentAssetService.getAsset(documentAssetId);
      if (asset.status !== 'READY') {
        res.status(400).json({ status: 'ERR', message: 'Tài liệu chưa sẵn sàng để tải.' });
        return;
      }

      const token = await documentViewAccessService.createSession({
        userId: req.userId!,
        documentAssetId,
        mode: 'download',
      });

      res.status(201).json({
        status: 'OK',
        data: {
          asset: sanitizeDocumentAsset(asset, { userId: req.userId, role: req.userRole }),
          downloadUrl: `/api/media/documents/${documentAssetId}/download?token=${encodeURIComponent(token)}`,
          expiresIn: documentViewAccessService.ttlSeconds,
        },
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async downloadDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      const documentAssetId = req.params.documentAssetId as string;
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) {
        res.status(400).send('Missing document download token');
        return;
      }

      const validSession = await documentViewAccessService.validateSession(token, req.userId!, documentAssetId, 'download');
      if (!validSession) {
        res.status(403).send('Invalid document download session');
        return;
      }

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
