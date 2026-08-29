// Route upload video gồm: khởi tạo multipart -> cấp Presigned URL -> xác nhận hoặc hủy upload.
// Trình duyệt PUT các part thẳng lên R2; các route này chỉ điều phối metadata và phiên tải.
// Nhóm route phía sau phục vụ đọc trạng thái và phát video sau khi asset đã xử lý xong.

import { Router } from 'express';
import videoAssetController from '../controllers/videoAsset.controller';
import { requireVideoAssetAccess, requireVideoAssetOwner } from '../middlewares/videoAssetOwnership.middleware';

const router = Router();

// Giai đoạn 1: nhận tệp gốc bằng Multipart Upload.
// [POST] /api/media/videos/initiate-upload — Tạo VideoAsset và phiên multipart để trình duyệt tải video gốc thẳng lên R2.
router.post('/initiate-upload', videoAssetController.initiateUpload);
// [POST] /api/media/videos/:videoAssetId/confirm-upload — Hoàn tất multipart và đưa asset vào hàng đợi xử lý HLS.
router.post('/:videoAssetId/confirm-upload', requireVideoAssetOwner, videoAssetController.confirmUpload);
// [POST] /api/media/videos/:videoAssetId/abort-upload — Hủy multipart dở dang và dọn dữ liệu upload của chủ sở hữu.
router.post('/:videoAssetId/abort-upload', requireVideoAssetOwner, videoAssetController.abortUpload);
// [GET] /api/media/videos/:videoAssetId/batch-part-urls — Cấp một nhóm Presigned URL để upload các part trực tiếp lên R2.
router.get('/:videoAssetId/batch-part-urls', requireVideoAssetOwner, videoAssetController.getBatchPartUrls);
// Giai đoạn 2: Frontend đọc trạng thái xử lý nền; các route còn lại phục vụ phát HLS.
// [GET] /api/media/videos/:videoAssetId — Lấy metadata và trạng thái xử lý của VideoAsset được phép truy cập.
router.get('/:videoAssetId', requireVideoAssetAccess, videoAssetController.getAsset);
// [POST] /api/media/videos/:videoAssetId/playback-session — Xác minh Learning Lease và cấp Playback Token dùng một lần.
router.post('/:videoAssetId/playback-session', requireVideoAssetAccess, videoAssetController.createPlaybackSession);
// [GET] /api/media/videos/:videoAssetId/manifest — Trả playlist.m3u8 của chất lượng đã chọn sau khi kiểm tra Key Session.
router.get('/:videoAssetId/manifest', requireVideoAssetAccess, videoAssetController.getRenditionManifest);
// [GET] /api/media/videos/:videoAssetId/segment — Kiểm tra Key Session/Segment Ticket rồi redirect tới segment trên R2.
router.get('/:videoAssetId/segment', requireVideoAssetAccess, videoAssetController.getSegment);
// [GET] /api/media/videos/:videoAssetId/key — Kiểm tra phiên phát và trả khóa AES-128 để Hls.js giải mã segment.
router.get('/:videoAssetId/key', requireVideoAssetAccess, videoAssetController.getEncryptionKey);

export default router;
