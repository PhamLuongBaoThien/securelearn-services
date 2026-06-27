// [BƯỚC 2 & BƯỚC 2.4 & BƯỚC 2.7: CONTROLLER QUẢN LÝ TÀI NGUYÊN VIDEO]
// Xử lý các nghiệp vụ: Upload, Polling, sinh Manifest an toàn, kiểm tra Key Session để cấp khóa giải mã AES-128.

import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import videoAssetService from '../services/videoAsset.service';
import playbackAccessService from '../services/playbackAccess.service';

const sanitizeVideoAsset = (asset: Awaited<ReturnType<typeof videoAssetService.getAsset>>) => {
  const { encryptionKey: _hiddenKey, rawObjectKey: _hiddenRawKey, multipartUploadId: _hiddenUploadId, ...safeAsset } = asset;
  return safeAsset;
};

class VideoAssetController {
  public async initiateUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { courseId, lessonId, fileName, mimeType, sizeBytes } = req.body;
      if (!fileName || !mimeType || !sizeBytes) {
        res.status(400).json({ status: 'ERR', message: 'Thiếu thông tin file: fileName, mimeType, sizeBytes.' });
        return;
      }
      const data = await videoAssetService.initiateUpload({
        ownerUserId: req.userId!,
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

  public async getAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      res.status(200).json({ status: 'OK', data: sanitizeVideoAsset(asset) });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  public async getEncryptionKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      const session = typeof req.query.session === 'string' ? req.query.session : '';

      if (!req.userId) {
        res.status(401).send('Authentication required');
        return;
      }
      if (!session) {
        res.status(403).send('Key requires playback session');
        return;
      }

      const validSession = await playbackAccessService.validateKeySession(
        session,
        videoAssetId,
        req.userId,
      );
      if (!validSession) {
        res.status(403).send('Invalid key session');
        return;
      }

      if (!asset.encryptionKey) {
        res.status(404).send('Key not found or not ready');
        return;
      }

      const keyBuffer = Buffer.from(asset.encryptionKey, 'hex');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(keyBuffer);
    } catch {
      res.status(404).send('Asset not found');
    }
  }

  public async createPlaybackSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      const playbackInput = {
        userId: req.userId!,
        videoAssetId,
        courseId: String(asset.courseId),
      };

      const token = await playbackAccessService.createOneTimePlayback(playbackInput);

      res.status(201).json({
        status: 'OK',
        data: {
          asset: sanitizeVideoAsset(asset),
          playbackUrl: `/api/media/videos/${videoAssetId}/playback?token=${encodeURIComponent(token)}`,
          expiresIn: 60,
          segmentExpiresIn: videoAssetService.playbackSegmentUrlTtlSeconds,
        },
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getOneTimePlaybackManifest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const token = typeof req.query.token === 'string' ? req.query.token : '';

      if (!token) {
        res.status(400).json({ status: 'ERR', message: 'Thiếu playback token.' });
        return;
      }

      const playback = await playbackAccessService.consumeOneTimePlayback(token);
      if (!playback || playback.videoAssetId !== videoAssetId) {
        res.status(410).json({ status: 'ERR', message: 'Playback URL đã hết hạn hoặc đã được sử dụng.' });
        return;
      }

      const keySession = await playbackAccessService.createKeySession({
        userId: playback.userId,
        videoAssetId,
      });

      const keyUri = `/api/media/videos/${videoAssetId}/key?session=${encodeURIComponent(keySession)}`;
      const manifest = await videoAssetService.getPlaybackManifest(videoAssetId, keyUri, keySession);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(manifest);
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  public async getRenditionManifest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const quality = typeof req.query.quality === 'string' ? req.query.quality : '';
      const session = typeof req.query.session === 'string' ? req.query.session : '';

      if (!req.userId) {
        res.status(401).json({ status: 'ERR', message: 'Authentication required.' });
        return;
      }
      if (!quality || !session) {
        res.status(400).json({ status: 'ERR', message: 'Thiếu quality hoặc session.' });
        return;
      }

      const validSession = await playbackAccessService.validateKeySession(session, videoAssetId, req.userId);
      if (!validSession) {
        res.status(403).json({ status: 'ERR', message: 'Key session không hợp lệ.' });
        return;
      }

      const keyUri = `/api/media/videos/${videoAssetId}/key?session=${encodeURIComponent(session)}`;
      const manifest = await videoAssetService.getRenditionManifest(videoAssetId, quality, keyUri);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(manifest);
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  public async getBatchPartUrls(req: AuthRequest, res: Response): Promise<void> {
    try {
      const totalParts = parseInt(req.query.totalParts as string, 10);
      if (!totalParts || totalParts < 1 || totalParts > 10000) {
        res.status(400).json({ status: 'ERR', message: 'totalParts không hợp lệ.' });
        return;
      }

      const videoAssetId = req.params.videoAssetId as string;
      const urls = await videoAssetService.getBatchPartPresignedUrls(videoAssetId, totalParts);
      res.status(200).json({ status: 'OK', data: { urls } });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

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
      );
      if (hasInvalidPart) {
        res.status(400).json({ status: 'ERR', message: 'Thông tin ETag/PartNumber không hợp lệ.' });
        return;
      }
      const asset = await videoAssetService.confirmUpload(videoAssetId, parts);
      const normalized = typeof (asset as { toObject?: () => unknown }).toObject === 'function'
        ? (asset as { toObject: () => unknown }).toObject()
        : asset;
      res.status(200).json({ status: 'OK', message: 'Đang xử lý video.', data: sanitizeVideoAsset(normalized as Awaited<ReturnType<typeof videoAssetService.getAsset>>) });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

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
