// File này khai báo route video asset.
// Video dùng direct multipart upload: initiate-upload → batch-part-urls → confirm-upload.
import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';

const router = Router();

// [POST] /api/media/videos/initiate-upload
router.post('/initiate-upload', videoAssetController.initiateUpload);

// [GET] /api/media/videos/:videoAssetId/batch-part-urls?totalParts=N
// Sinh tất cả presigned URLs cho file trong 1 request duy nhất (tối ưu tốc độ upload)
router.get('/:videoAssetId/batch-part-urls', videoAssetController.getBatchPartUrls);

// [POST] /api/media/videos/:videoAssetId/confirm-upload  (direct upload)
router.post('/:videoAssetId/confirm-upload', videoAssetController.confirmUpload);

// [POST] /api/media/videos/:videoAssetId/abort-upload  (direct upload cancel)
router.post('/:videoAssetId/abort-upload', videoAssetController.abortUpload);

// [GET] /api/media/videos/:videoAssetId
router.get('/:videoAssetId', videoAssetController.getAsset);

// [GET] /api/media/videos/:videoAssetId/key
router.get('/:videoAssetId/key', videoAssetController.getEncryptionKey);

export default router;
