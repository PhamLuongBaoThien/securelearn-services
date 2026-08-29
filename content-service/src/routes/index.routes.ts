import { Application } from 'express';
import adminBannerRoutes from './adminBanner.routes';
import adminPolicyRoutes from './adminPolicy.routes';
import adminWebsiteConfigRoutes from './adminWebsiteConfig.routes';
import bannerRoutes from './banner.routes';
import policyRoutes from './policy.routes';
import websiteConfigRoutes from './websiteConfig.routes';

export const registerRoutes = (app: Application) => {
  // Mount API quản trị cấu hình logo, favicon và thông tin nhận diện website.
  app.use('/api/admin/system/config', adminWebsiteConfigRoutes);
  // Mount API quản trị banner: tạo, sửa, sắp xếp, bật/tắt và xóa.
  app.use('/api/admin/system/banners', adminBannerRoutes);
  // Mount API quản trị nội dung chính sách và trạng thái công khai.
  app.use('/api/admin/system/policies', adminPolicyRoutes);
  // Mount API công khai trả các banner đang hoạt động cho frontend.
  app.use('/api/banners', bannerRoutes);
  // Mount API công khai danh sách/chi tiết chính sách theo slug.
  app.use('/api/policies', policyRoutes);
  // Mount API công khai cấu hình nhận diện website.
  app.use('/api/website-config', websiteConfigRoutes);
};
