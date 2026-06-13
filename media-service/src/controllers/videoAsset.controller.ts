// ========================
// Video Asset Controller
// Mục đích:
// - mở API upload, polling và đọc key/manifest cho video asset
// - chỉ trả metadata an toàn sau khi middleware đã check owner hoặc learner entitlement
// ========================
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import videoAssetService from '../services/videoAsset.service';

class VideoAssetController {
  // [POST] /api/media/videos/initiate-upload
  public async initiateUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { courseId, lessonId, fileName, mimeType, sizeBytes } = req.body;
      if (!fileName || !mimeType || !sizeBytes) {
        res.status(400).json({ status: 'ERR', message: 'Thiếu thông tin file: fileName, mimeType, sizeBytes.' });
        return;
      }
      const data = await videoAssetService.initiateUpload({
        ownerUserId: req.userId!, // ! cuối cùng để khẳng định userId đã được gán bởi middleware auth
        courseId,
        lessonId,
        fileName,
        mimeType,
        sizeBytes: Number(sizeBytes),
      });
      res.status(201).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  // [GET] /api/media/videos/:videoAssetId
  public async getAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      // Không trả encryption key và multipart internals ở API metadata để tránh lộ thông tin nhạy cảm.
      const { encryptionKey: _hiddenKey, rawObjectKey: _hiddenRawKey, multipartUploadId: _hiddenUploadId, ...safeAsset } = asset;
      res.status(200).json({ status: 'OK', data: safeAsset });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  // [GET] /api/media/videos/:videoAssetId/key
  public async getEncryptionKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      if (!asset.encryptionKey) {
        res.status(404).send('Key not found or not ready');
        return;
      }
      const keyBuffer = Buffer.from(asset.encryptionKey, 'hex');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(keyBuffer);
    } catch (error: any) {
      res.status(404).send('Asset not found');
    }
  }

  // [GET] /api/media/videos/:videoAssetId/batch-part-urls?totalParts=N
  // Tạo toàn bộ presigned URLs cho 1 file trong 1 request duy nhất.
  public async getBatchPartUrls(req: AuthRequest, res: Response): Promise<void> {
    try {
      const totalParts = parseInt(req.query.totalParts as string, 10);
      if (!totalParts || totalParts < 1 || totalParts > 10000) {
        res.status(400).json({ status: 'ERR', message: 'totalParts không hợp lệ.' });
        return;
      }

      const videoAssetId = req.params.videoAssetId as string;
      const urls = await videoAssetService.getBatchPartPresignedUrls(
        videoAssetId,
        totalParts,
      );
      res.status(200).json({ status: 'OK', data: { urls } });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  // [POST] /api/media/videos/:videoAssetId/confirm-upload
  public async confirmUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const { parts } = req.body as { parts: { ETag: string; PartNumber: number }[] };
      if (!Array.isArray(parts) || parts.length === 0) {
        res.status(400).json({ status: 'ERR', message: 'Danh sách parts không hợp lệ.' });
        return;
      }
      const hasInvalidPart = parts.some(
        (part) => !part?.ETag || !Number.isInteger(part.PartNumber) || part.PartNumber < 1,
      ); // .some() để kiểm tra nếu có phần tử nào trong mảng không hợp lệ, tránh lỗi khi gọi service confirmUpload
      if (hasInvalidPart) {
        res.status(400).json({ status: 'ERR', message: 'Thông tin ETag/PartNumber không hợp lệ.' });
        return;
      }
      const asset = await videoAssetService.confirmUpload(videoAssetId, parts);
      res.status(200).json({ status: 'OK', message: 'Đang xử lý video.', data: asset });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  // [POST] /api/media/videos/:videoAssetId/abort-upload
  public async abortUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      await videoAssetService.abortUpload(videoAssetId);
      res.status(200).json({ status: 'OK', message: 'Đã hủy upload.' });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new VideoAssetController();
