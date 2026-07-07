import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import cloudinary from '../config/cloudinary';
import websiteConfigService from '../services/websiteConfig.service';

type WebsiteFiles = {
  logo?: Array<{ filename?: string }>;
  favicon?: Array<{ filename?: string }>;
};

const sendError = (res: Response, error: any) =>
  res.status(error.status || 500).json({ status: 'ERR', message: error.status ? error.message : 'Lỗi hệ thống máy chủ.' });

const cleanupUploaded = (files?: WebsiteFiles) => {
  const publicIds = [files?.logo?.[0]?.filename, files?.favicon?.[0]?.filename].filter(Boolean) as string[];
  publicIds.forEach((publicId) => void cloudinary.uploader.destroy(publicId, { resource_type: 'image' }));
};

class WebsiteConfigController {
  get = async (_req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Lấy cấu hình website thành công.', data: await websiteConfigService.getConfig() }); }
    catch (error) { sendError(res, error); }
  };

  update = async (req: AuthRequest, res: Response) => {
    try {
      res.json({
        status: 'OK',
        message: 'Đã cập nhật cấu hình website.',
        data: await websiteConfigService.updateConfig(req.body, req.files as any),
      });
    } catch (error) {
      cleanupUploaded(req.files as WebsiteFiles);
      sendError(res, error);
    }
  };
}

export default new WebsiteConfigController();
