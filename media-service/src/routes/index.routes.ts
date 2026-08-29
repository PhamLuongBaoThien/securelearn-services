// File này mount route cho media-service.
// Playback manifest dùng one-time capability token nên được đặt trước extractUser.
// Encryption key phải đi qua extractUser và route được Kong bảo vệ bằng JWT.
import { Application } from 'express';
import documentAssetRoutes from './documentAsset.routes';
import videoAssetRoutes from './videoAsset.routes';
import videoAssetController from '../controllers/videoAsset.controller';
import { extractUser } from '../middlewares/auth.middleware';

const routes = (app: Application) => {
  // [GET] /api/media/videos/:videoAssetId/playback — Tiêu thụ Playback Token một lần, tạo Key Session và trả master.m3u8.
  app.get('/api/media/videos/:videoAssetId/playback', videoAssetController.getOneTimePlaybackManifest);

  // Mount các API video có JWT tại /api/media/videos; từng route tiếp tục kiểm tra owner/entitlement/learning lease.
  app.use('/api/media/videos', extractUser, videoAssetRoutes);
  // Mount các API tài liệu có JWT tại /api/media/documents; middleware con kiểm tra quyền asset.
  app.use('/api/media/documents', extractUser, documentAssetRoutes);
};

export default routes;
