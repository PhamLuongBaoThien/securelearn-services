// Route upload video gồm: khởi tạo multipart -> cấp Presigned URL -> xác nhận hoặc hủy upload.
// Trình duyệt PUT các part thẳng lên R2; các route này chỉ điều phối metadata và phiên tải.
// Nhóm route phía sau phục vụ đọc trạng thái và phát video sau khi asset đã xử lý xong.

import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';
import { requireVideoAssetAccess, requireVideoAssetOwner } from '../middlewares/videoAssetOwnership.middleware';

const router = Router();

// Giai đoạn 1: nhận tệp gốc bằng Multipart Upload.
router.post('/initiate-upload', videoAssetController.initiateUpload);
router.post('/:videoAssetId/confirm-upload', requireVideoAssetOwner, videoAssetController.confirmUpload);
router.post('/:videoAssetId/abort-upload', requireVideoAssetOwner, videoAssetController.abortUpload);
router.get('/:videoAssetId/batch-part-urls', requireVideoAssetOwner, videoAssetController.getBatchPartUrls);
// Giai đoạn 2: Frontend đọc trạng thái xử lý nền; các route còn lại phục vụ phát HLS.
router.get('/:videoAssetId', requireVideoAssetAccess, videoAssetController.getAsset);
router.post('/:videoAssetId/playback-session', requireVideoAssetAccess, videoAssetController.createPlaybackSession);
router.get('/:videoAssetId/manifest', requireVideoAssetAccess, videoAssetController.getRenditionManifest);
router.get('/:videoAssetId/segment', requireVideoAssetAccess, videoAssetController.getSegment);
router.get('/:videoAssetId/key', requireVideoAssetAccess, videoAssetController.getEncryptionKey);

export default router;
