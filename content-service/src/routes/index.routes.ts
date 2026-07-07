import { Application } from 'express';
import adminBannerRoutes from './adminBanner.routes';
import bannerRoutes from './banner.routes';

export const registerRoutes = (app: Application) => {
  app.use('/api/admin/system/banners', adminBannerRoutes);
  app.use('/api/banners', bannerRoutes);
};
