// File này mount route cho media-service.
// Playback manifest dùng one-time capability token nên được đặt trước extractUser.
// Encryption key phải đi qua extractUser và route được Kong bảo vệ bằng JWT.
import { Application } from 'express';
import documentAssetRoutes from './documentAsset.routes';
import videoAssetRoutes from './videoAsset.routes';
import videoAssetController from '../controllers/videoAsset.controller';
import { extractUser } from '../middlewares/auth.middleware';

const routes = (app: Application) => {
  app.get('/api/media/videos/:videoAssetId/playback', videoAssetController.getOneTimePlaybackManifest);

  app.use('/api/media/videos', extractUser, videoAssetRoutes);
  app.use('/api/media/documents', extractUser, documentAssetRoutes);
};

export default routes;
