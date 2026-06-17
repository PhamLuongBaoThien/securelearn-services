// ========================
// Video Asset Routes
// Mục đích:
// - khai báo route upload và đọc video asset của media-service
// - tách route owner-only với route learner access đã qua entitlement check
// ========================
import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';
import { requireVideoAssetAccess, requireVideoAssetOwner } from '../middlewares/videoAssetOwnership.middleware';

const router = Router();

// [POST] /api/media/videos/initiate-upload
router.post('/initiate-upload', videoAssetController.initiateUpload);

// Các route theo videoAssetId đều gắn requireVideoAssetOwner:
// middleware chạy trước controller để chặn user khác poll/key/confirm/abort asset không thuộc về họ.

// [POST] /api/media/videos/:videoAssetId/confirm-upload  (direct upload)
router.post('/:videoAssetId/confirm-upload', requireVideoAssetOwner, videoAssetController.confirmUpload);

// [POST] /api/media/videos/:videoAssetId/abort-upload  (direct upload cancel)
router.post('/:videoAssetId/abort-upload', requireVideoAssetOwner, videoAssetController.abortUpload);

// [GET] /api/media/videos/:videoAssetId/batch-part-urls?totalParts=N
// Sinh tất cả presigned URLs cho file trong 1 request duy nhất (tối ưu tốc độ upload)
router.get('/:videoAssetId/batch-part-urls', requireVideoAssetOwner, videoAssetController.getBatchPartUrls);

// [GET] /api/media/videos/:videoAssetId
// Polling trạng thái/video manifest cho cả owner và learner có entitlement hợp lệ.
router.get('/:videoAssetId', requireVideoAssetAccess, videoAssetController.getAsset);

// [POST] /api/media/videos/:videoAssetId/playback-session
// Kiểm tra quyền Redis-first rồi sinh one-time URL để lấy manifest HLS.
router.post('/:videoAssetId/playback-session', requireVideoAssetAccess, videoAssetController.createPlaybackSession);

// [GET] /api/media/videos/:videoAssetId/playback?token=...
// Consume one-time URL và trả manifest đã rewrite key session.
router.get('/:videoAssetId/playback', videoAssetController.getOneTimePlaybackManifest);

// [GET] /api/media/videos/:videoAssetId/manifest
router.get('/:videoAssetId/manifest', requireVideoAssetAccess, videoAssetController.getPlaybackManifest);

// [GET] /api/media/videos/:videoAssetId/key
router.get('/:videoAssetId/key', requireVideoAssetAccess, videoAssetController.getEncryptionKey);

export default router;
