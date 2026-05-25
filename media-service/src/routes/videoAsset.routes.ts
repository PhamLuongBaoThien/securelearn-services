// File này khai báo route video asset.
// Video dùng direct multipart upload: initiate-upload → batch-part-urls → confirm-upload.
import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';
import { requireVideoAssetOwner } from '../middlewares/videoAssetOwnership.middleware';

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
router.get('/:videoAssetId', requireVideoAssetOwner, videoAssetController.getAsset);

// [GET] /api/media/videos/:videoAssetId/key
router.get('/:videoAssetId/key', requireVideoAssetOwner, videoAssetController.getEncryptionKey);

export default router;
