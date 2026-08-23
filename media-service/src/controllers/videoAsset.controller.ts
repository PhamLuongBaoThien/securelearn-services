// [BƯỚC 2 & BƯỚC 2.4 & BƯỚC 2.7: CONTROLLER QUẢN LÝ TÀI NGUYÊN VIDEO]
// Xử lý các nghiệp vụ: Upload, Polling, sinh Manifest an toàn, kiểm tra Key Session để cấp khóa giải mã AES-128.

import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import videoAssetService from '../services/videoAsset.service';
import playbackAccessService from '../services/playbackAccess.service';
import learningLeaseService, { MediaLearningLeaseError } from '../services/learningLease.service';

/** Loại encryptionKey khỏi dữ liệu VideoAsset trước khi trả metadata cho Frontend. */
const sanitizeVideoAsset = (asset: Awaited<ReturnType<typeof videoAssetService.getAsset>>) => {
  const { encryptionKey: _hiddenKey, rawObjectKey: _hiddenRawKey, multipartUploadId: _hiddenUploadId, ...safeAsset } = asset;
  return safeAsset;
};

class VideoAssetController {
  /**
   * POST /api/media/videos/initiate-upload
   * Nhận metadata tệp, lấy người sở hữu từ JWT và yêu cầu service mở Multipart Upload trên R2.
   */
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

  /**
   * GET /api/media/videos/:videoAssetId
   * Trả metadata và tiến độ để Frontend theo dõi video từ QUEUED/PROCESSING đến READY/FAILED.
   */
  public async getAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      res.status(200).json({ status: 'OK', data: sanitizeVideoAsset(asset) });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [FLOW HỌC VIDEO - MEDIA.8: CẤP KHÓA AES-128]
   * Được Hls.js gọi từ URI đã viết lại trong leaf playlist.
   * Chỉ trả khóa khi JWT, Key Session, auth session và Learning Lease vẫn hợp lệ.
   */
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
        req.sessionId,
        String(req.get('x-learning-client-instance-id') || ''),
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
    } catch (error: any) {
      if (error instanceof MediaLearningLeaseError) {
        res.status(error.statusCode).json({ status: 'ERR', code: error.code, message: error.message });
        return;
      }
      res.status(404).send('Asset not found');
    }
  }

  /**
   * [FLOW HỌC VIDEO - MEDIA.1: TẠO PLAYBACK SESSION]
   * Nhận JWT và Learning Session headers từ VideoPlayer, xác minh lease rồi sinh Playback Token dùng một lần.
   * Trả playbackUrl để Hls.js bắt đầu tải master.m3u8.
   */
  public async createPlaybackSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const asset = await videoAssetService.getAsset(videoAssetId);
      const bypassLearningLease = req.videoAccessMode === 'OWNER_PREVIEW';
      const learningSessionId = String(req.get('x-learning-session-id') || '');
      const learningSessionToken = String(req.get('x-learning-session-token') || '');
      const clientInstanceId = String(req.get('x-learning-client-instance-id') || '');
      let resolvedLease: {
        learningSessionId?: string;
        tokenHash?: string;
        authSessionId?: string;
        clientInstanceId?: string;
        courseVersionId?: string;
        lessonId?: string;
      } | null = null;
      if (!bypassLearningLease) {
        const lease = await learningLeaseService.validate({
          userId: req.userId!, authSessionId: req.sessionId!, learningSessionId, learningSessionToken,
          videoAssetId,
        });
        resolvedLease = {
          learningSessionId: lease.learningSessionId,
          tokenHash: lease.tokenHash,
          authSessionId: lease.authSessionId,
          clientInstanceId: lease.clientInstanceId,
          courseVersionId: lease.courseVersionId || lease.courseId,
          lessonId: lease.lessonId,
        };
      }
      const token = await playbackAccessService.createOneTimePlayback({
        userId: req.userId!, videoAssetId,
        courseId: bypassLearningLease ? String(asset.courseId) : resolvedLease?.courseVersionId || String(asset.courseId),
        lessonId: bypassLearningLease ? String(asset.lessonId) : resolvedLease?.lessonId || String(asset.lessonId),
        bypassLearningLease,
        learningSessionId: bypassLearningLease ? undefined : resolvedLease?.learningSessionId || learningSessionId,
        learningTokenHash: bypassLearningLease ? undefined : resolvedLease?.tokenHash || learningLeaseService.tokenHash(learningSessionToken),
        authSessionId: bypassLearningLease ? undefined : resolvedLease?.authSessionId || req.sessionId!,
        clientInstanceId: bypassLearningLease ? undefined : resolvedLease?.clientInstanceId || clientInstanceId,
      });
      res.status(201).json({ status: 'OK', data: {
        asset: sanitizeVideoAsset(asset),
        playbackUrl: `/api/media/videos/${videoAssetId}/playback?token=${encodeURIComponent(token)}`,
        expiresIn: 60, segmentExpiresIn: videoAssetService.playbackSegmentUrlTtlSeconds,
      }});
    } catch (error: any) {
      if (error instanceof MediaLearningLeaseError) {
        console.warn('[MediaPlayback] createPlaybackSession failed', {
          code: error.code,
          message: error.message,
          userId: req.userId,
          sessionId: req.sessionId,
          learningSessionId: String(req.get('x-learning-session-id') || ''),
          clientInstanceId: String(req.get('x-learning-client-instance-id') || ''),
          videoAssetId: req.params.videoAssetId,
        });
      }
      const status = error instanceof MediaLearningLeaseError ? error.statusCode : 400;
      res.status(status).json({ status: 'ERR', code: error.code, message: error.message });
    }
  }

  /**
   * [FLOW HỌC VIDEO - MEDIA.4: TRẢ MASTER PLAYLIST]
   * Tiêu thụ và xóa Playback Token, kiểm tra lease còn sống, tạo Key Session rồi viết lại master.m3u8.
   * Token đã dùng/hết hạn trả 410 để URL khởi tạo không thể tái sử dụng.
   */
  public async getOneTimePlaybackManifest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) { res.status(400).json({ status: 'ERR', message: 'Thiếu playback token.' }); return; }
      const playback = await playbackAccessService.consumeOneTimePlayback(token);
      if (!playback || playback.videoAssetId !== videoAssetId) {
        res.status(410).json({ status: 'ERR', message: 'Playback URL đã hết hạn hoặc đã được sử dụng.' }); return;
      }
      const activePlayback = await playbackAccessService.validatePlaybackReference(playback);
      if (!activePlayback) {
        throw new MediaLearningLeaseError(409, 'LEARNING_SESSION_REPLACED', 'Phiên học đã được chuyển sang thiết bị hoặc tab khác.');
      }
      const keySession = await playbackAccessService.createKeySession({
        userId: playback.userId, videoAssetId, courseId: playback.courseId, lessonId: playback.lessonId,
        bypassLearningLease: playback.bypassLearningLease, learningSessionId: playback.learningSessionId,
        learningTokenHash: playback.learningTokenHash, authSessionId: playback.authSessionId,
        clientInstanceId: playback.clientInstanceId,
      });
      const keyUri = `/api/media/videos/${videoAssetId}/key?session=${encodeURIComponent(keySession)}`;
      const manifest = await videoAssetService.getPlaybackManifest(videoAssetId, keyUri, keySession);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(manifest);
    } catch (error: any) {
      const status = error instanceof MediaLearningLeaseError ? error.statusCode : 404;
      res.status(status).json({ status: 'ERR', code: error.code, message: error.message });
    }
  }

  /**
   * [FLOW HỌC VIDEO - MEDIA.6: TRẢ PLAYLIST CHẤT LƯỢNG]
   * Hls.js gọi sau khi chọn rendition; controller xác minh Key Session rồi trả leaf playlist đã bảo vệ key/segment.
   */
  public async getRenditionManifest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = req.params.videoAssetId as string;
      const quality = typeof req.query.quality === 'string' ? req.query.quality : '';
      const session = typeof req.query.session === 'string' ? req.query.session : '';
      if (!req.userId) { res.status(401).json({ status: 'ERR', message: 'Authentication required.' }); return; }
      if (!quality || !session) { res.status(400).json({ status: 'ERR', message: 'Thiếu quality hoặc session.' }); return; }
      const validSession = await playbackAccessService.validateKeySession(session, videoAssetId, req.userId, req.sessionId, String(req.get('x-learning-client-instance-id') || ''));
      if (!validSession) { res.status(403).json({ status: 'ERR', code: 'INVALID_PLAYBACK_SESSION', message: 'Key session không hợp lệ.' }); return; }
      const keyUri = `/api/media/videos/${videoAssetId}/key?session=${encodeURIComponent(session)}`;
      const manifest = await videoAssetService.getRenditionManifest(videoAssetId, quality, keyUri, session);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(manifest);
    } catch (error: any) {
      const status = error instanceof MediaLearningLeaseError ? error.statusCode : 404;
      res.status(status).json({ status: 'ERR', code: error.code, message: error.message });
    }
  }

  /**
   * [FLOW HỌC VIDEO - MEDIA.9: CẤP SEGMENT]
   * Xác minh Key Session và Segment Ticket, tạo Presigned URL ngắn hạn rồi trả 302 để browser tải trực tiếp từ R2.
   */
  public async getSegment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const videoAssetId = String(req.params.videoAssetId || '');
      const session = String(req.query.session || '');
      const ticket = String(req.query.ticket || '');
      if (!req.userId || !session || !ticket) { res.status(400).json({ status: 'ERR', message: 'Thiếu thông tin segment.' }); return; }
      // Segment được redirect sang object storage. Không yêu cầu custom client header tại đây
      // để trình duyệt không chuyển tiếp header đó sang MinIO và kích hoạt CORS preflight.
      // Key session vẫn được ràng buộc với user, auth session (sid) và learning lease hiện tại.
      const validSession = await playbackAccessService.validateKeySession(
        session,
        videoAssetId,
        req.userId,
        req.sessionId,
        undefined,
        { requireClientInstance: false },
      );
      if (!validSession) { res.status(403).json({ status: 'ERR', code: 'INVALID_PLAYBACK_SESSION', message: 'Phiên phát video không hợp lệ.' }); return; }
      const url = await videoAssetService.getSegmentRedirectUrl(videoAssetId, ticket);
      res.setHeader('Cache-Control', 'private, no-store');
      res.redirect(302, url);
    } catch (error: any) {
      const status = error instanceof MediaLearningLeaseError ? error.statusCode : 403;
      res.status(status).json({ status: 'ERR', code: error.code, message: error.message });
    }
  }

  /**
   * GET /api/media/videos/:videoAssetId/batch-part-urls
   * Kiểm tra số part và cấp Presigned URL tương ứng cho trình duyệt tải trực tiếp lên R2.
   */
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

  /**
   * POST /api/media/videos/:videoAssetId/confirm-upload
   * Kiểm tra danh sách PartNumber/ETag rồi hoàn tất tệp gốc và đưa video vào hàng đợi xử lý nền.
   */
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
      res.status(200).json({ status: 'OK', message: 'Video đã vào hàng đợi xử lý.', data: sanitizeVideoAsset(normalized as Awaited<ReturnType<typeof videoAssetService.getAsset>>) });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * POST /api/media/videos/:videoAssetId/abort-upload
   * Hủy multipart session khi người dùng hủy hoặc Frontend gặp lỗi trước bước confirm.
   */
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
