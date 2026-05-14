// File này khai báo route video asset.
// Video dùng flow 2 bước: initiate-upload → upload-complete.
import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';
import { uploadVideo } from '../middlewares/upload.middleware';

const router = Router();

// [POST] /api/media/videos/initiate-upload
router.post('/initiate-upload', videoAssetController.initiateUpload);

// [POST] /api/media/videos/:videoAssetId/upload-complete
router.post('/:videoAssetId/upload-complete', uploadVideo.single('file'), videoAssetController.completeUpload);

// [GET] /api/media/videos/:videoAssetId
router.get('/:videoAssetId', videoAssetController.getAsset);

// [GET] /api/media/videos/:videoAssetId/key
router.get('/:videoAssetId/key', videoAssetController.getEncryptionKey);

export default router;
