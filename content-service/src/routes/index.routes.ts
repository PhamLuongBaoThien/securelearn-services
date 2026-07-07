import { Application } from 'express';
import adminBannerRoutes from './adminBanner.routes';
import adminWebsiteConfigRoutes from './adminWebsiteConfig.routes';
import bannerRoutes from './banner.routes';
import websiteConfigRoutes from './websiteConfig.routes';

export const registerRoutes = (app: Application) => {
  app.use('/api/admin/system/config', adminWebsiteConfigRoutes);
  app.use('/api/admin/system/banners', adminBannerRoutes);
  app.use('/api/banners', bannerRoutes);
  app.use('/api/website-config', websiteConfigRoutes);
};
