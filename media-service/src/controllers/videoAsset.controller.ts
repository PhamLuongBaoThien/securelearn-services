// Controller cho video asset — flow 2 bước: initiate → upload-complete.
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import videoAssetService from '../services/videoAsset.service';

class VideoAssetController {
  // [POST] /api/media/videos/initiate-upload
  public async initiateUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await videoAssetService.initiateUpload({
        ownerUserId: req.userId!,
        courseId: req.body.courseId,
        lessonId: req.body.lessonId,
      });
      res.status(201).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  // [POST] /api/media/videos/:videoAssetId/upload-complete
  public async completeUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng tải file video.' });
        return;
      }
      if (!req.file.mimetype.startsWith('video/')) {
        res
          .status(400)
          .json({ status: 'ERR', message: 'File không phải định dạng video hợp lệ.' });
        return;
      }
      const asset = await videoAssetService.completeUpload(
        req.params.videoAssetId as string,
        req.file,
      );
      res.status(200).json({ status: 'OK', message: 'Đã nhận file video, đang xử lý.', data: asset });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  // [GET] /api/media/videos/:videoAssetId
  public async getAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const asset = await videoAssetService.getAsset(req.params.videoAssetId as string);
      res.status(200).json({ status: 'OK', data: asset });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  // [GET] /api/media/videos/:videoAssetId/key
  public async getEncryptionKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const asset = await videoAssetService.getAsset(req.params.videoAssetId as string);
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
}

export default new VideoAssetController();
