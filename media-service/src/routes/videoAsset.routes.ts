// [BƯỚC 2 & BƯỚC 2.2 & BƯỚC 2.4: ĐỊNH TUYẾN TÀI NGUYÊN VIDEO (VIDEO ASSET ROUTING)]
// Phân chia các route dành riêng cho Admin/Giảng viên (Ownership) và Học viên (Entitlement).

import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';
import { requireVideoAssetAccess, requireVideoAssetOwner } from '../middlewares/videoAssetOwnership.middleware';

const router = Router();

router.post('/initiate-upload', videoAssetController.initiateUpload);
router.post('/:videoAssetId/confirm-upload', requireVideoAssetOwner, videoAssetController.confirmUpload);
router.post('/:videoAssetId/abort-upload', requireVideoAssetOwner, videoAssetController.abortUpload);
router.get('/:videoAssetId/batch-part-urls', requireVideoAssetOwner, videoAssetController.getBatchPartUrls);
router.get('/:videoAssetId', requireVideoAssetAccess, videoAssetController.getAsset);
router.post('/:videoAssetId/playback-session', requireVideoAssetAccess, videoAssetController.createPlaybackSession);
router.get('/:videoAssetId/manifest', requireVideoAssetAccess, videoAssetController.getRenditionManifest);
router.get('/:videoAssetId/segment', requireVideoAssetAccess, videoAssetController.getSegment);
router.get('/:videoAssetId/key', requireVideoAssetAccess, videoAssetController.getEncryptionKey);

export default router;
