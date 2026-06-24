// File này mount route cho media-service.
// Playback manifest và key endpoints dùng capability token nên được đặt trước extractUser.
import { Application } from 'express';
import documentAssetRoutes from './documentAsset.routes';
import videoAssetRoutes from './videoAsset.routes';
import videoAssetController from '../controllers/videoAsset.controller';
import { extractUser } from '../middlewares/auth.middleware';

const routes = (app: Application) => {
  app.get('/api/media/videos/:videoAssetId/playback', videoAssetController.getOneTimePlaybackManifest);
  app.get('/api/media/videos/:videoAssetId/key', videoAssetController.getEncryptionKey);

  app.use('/api/media/videos', extractUser, videoAssetRoutes);
  app.use('/api/media/documents', extractUser, documentAssetRoutes);
};

export default routes;
