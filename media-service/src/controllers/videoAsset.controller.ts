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

  // [BƯỚC 2 / BƯỚC 2.2: CẤP PHÁT KEY GIẢI MÃ NHỊ PHÂN QUA XÁC THỰC KEY SESSION]
  // Endpoint lấy key giải mã AES-128 của phân đoạn HLS (.ts).
  // Đảm bảo chỉ người dùng đang xem thực tế có keySession hợp lệ mới lấy được key giải mã.
  public async getEncryptionKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      const session = typeof req.query.session === 'string' ? req.query.session : '';
      
      // Route này đã qua JWT + extractUser. Key chỉ được cấp khi key session
      // đồng thời thuộc đúng user trong access token và đúng video đang request.
      if (!req.userId) {
        res.status(401).send('Authentication required');
        return;
      }
      if (!session) {
        res.status(403).send('Key requires playback session');
        return;
      }

      // Kiểm tra session có hợp lệ không (user và video khớp với session đã tạo ở bước trước)
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
      
      // Chuyển đổi chuỗi hex lưu trong DB thành dữ liệu binary buffer nhị phân thô để gửi về player giải mã
      const keyBuffer = Buffer.from(asset.encryptionKey, 'hex');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(keyBuffer);
    } catch (error: any) {
      res.status(404).send('Asset not found');
    }
  }

  // [BƯỚC 2: KHỞI TẠO PHIÊN PHÁT VIDEO - CẤP ONE-TIME PLAYBACK TOKEN]
  // Endpoint khởi tạo phiên xem video (Playback Session).
  // Kiểm tra entitlement qua middleware rồi tạo One-Time Playback Token hết hạn trong 60 giây.
  public async createPlaybackSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      const playbackInput = {
        userId: req.userId!,
        videoAssetId,
        courseId: String(asset.courseId),
      };
      
      // Tạo token xem manifest dùng một lần trong Redis
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

  // [BƯỚC 2.4: TIÊU THỤ PLAYBACK TOKEN & REWRITE MANIFEST (.m3u8)]
  // Endpoint consume Playback Token (consume - tiêu thụ) dùng 1 lần, sinh Key Session mới, rewrite URL của key giải mã và trả về nội dung file manifest HLS.
  public async getOneTimePlaybackManifest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const token = typeof req.query.token === 'string' ? req.query.token : '';

      // Kiểm tra token có tồn tại không
      if (!token) {
        res.status(400).json({ status: 'ERR', message: 'Thiếu playback token.' });
        return;
      }
      
      // Đọc và xóa (GET + DEL) token trong Redis ngay lập tức để chặn replay link
      const playback = await playbackAccessService.consumeOneTimePlayback(token);
      if (!playback || playback.videoAssetId !== videoAssetId) {
        res.status(410).json({ status: 'ERR', message: 'Playback URL đã hết hạn hoặc đã được sử dụng.' });
        return;
      }
      
      // Tạo Key Session mới trong Redis (hết hạn sau 5 phút) để cấp quyền lấy AES key giải mã
      // 1. KeySession là gì? 
      // KeySession là một token tạm thời (hết hạn sau 5 phút) được tạo ra sau khi Playback Token hợp lệ được tiêu thụ.
      // Mục đích của KeySession là để cấp quyền truy cập vào endpoint /api/media/videos/:videoAssetId/key, 
      // nơi người dùng có thể lấy AES key giải mã phân đoạn HLS.
      const keySession = await playbackAccessService.createKeySession({
        userId: playback.userId,
        videoAssetId,
      });
      
      // Viết lại URL của Key trong manifest để trỏ về API cấp key bảo mật kèm theo token Key Session
      const keyUri = `/api/media/videos/${videoAssetId}/key?session=${encodeURIComponent(keySession)}`;
      
      // Đọc manifest từ MinIO, rewrite và trả về trực tiếp
      const manifest = await videoAssetService.getPlaybackManifest(videoAssetId, keyUri);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, no-store'); // Chặn caching manifest

      // 2. Hàm send trong Express.js là gì? 
      // Hàm send trong Express.js là một phương thức của đối tượng Response được sử dụng để gửi dữ liệu response đến client.
      // Nó có thể gửi nhiều loại dữ liệu khác nhau, bao gồm chuỗi (String), Buffer, JSON, và mảng.
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
      res.status(200).json({ status: 'OK', message: 'Đang xử lý video.', data: asset });
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
