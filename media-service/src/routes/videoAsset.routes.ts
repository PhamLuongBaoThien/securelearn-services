// File này khai báo route video asset.
// Video dùng flow 2 bước: initiate-upload -> upload-complete.
import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

// [POST] /api/media/videos/initiate-upload
// Yêu cầu pre-signed ( pre-signed nghĩa là url có chữ ký) url để upload video
router.post('/initiate-upload', videoAssetController.initiateUpload);
// [POST] /api/media/videos/:videoAssetId/upload-complete
// Xác nhận upload video đã hoàn tất
router.post('/:videoAssetId/upload-complete', upload.single('file'), videoAssetController.completeUpload);
// [GET] /api/media/videos/:videoAssetId
// Lấy thông tin video asset
router.get('/:videoAssetId', videoAssetController.getAsset);

export default router;
