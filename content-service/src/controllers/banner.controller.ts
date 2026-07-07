import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import bannerService from '../services/banner.service';
import cloudinary from '../config/cloudinary';

const sendError = (res: Response, error: any) =>
  res.status(error.status || 500).json({ status: 'ERR', message: error.status ? error.message : 'Lỗi hệ thống máy chủ.' });

class BannerController {
  listPublic = async (_req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Lấy danh sách banner thành công.', data: await bannerService.listPublic() }); }
    catch (error) { sendError(res, error); }
  };
  listAdmin = async (_req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Lấy danh sách banner thành công.', data: await bannerService.listAdmin() }); }
    catch (error) { sendError(res, error); }
  };
  create = async (req: AuthRequest, res: Response) => {
    try { res.status(201).json({ status: 'OK', message: 'Đã thêm banner mới.', data: await bannerService.create(req.body, req.file) }); }
    catch (error) { if (req.file?.filename) void cloudinary.uploader.destroy(req.file.filename); sendError(res, error); }
  };
  update = async (req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Đã cập nhật banner.', data: await bannerService.update(req.params.id as string, req.body, req.file) }); }
    catch (error) { if (req.file?.filename) void cloudinary.uploader.destroy(req.file.filename); sendError(res, error); }
  };
  setStatus = async (req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Đã cập nhật trạng thái banner.', data: await bannerService.setStatus(req.params.id as string, req.body.isActive) }); }
    catch (error) { sendError(res, error); }
  };
  reorder = async (req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Đã cập nhật thứ tự banner.', data: await bannerService.reorder(req.body.ids) }); }
    catch (error) { sendError(res, error); }
  };
  delete = async (req: AuthRequest, res: Response) => {
    try { await bannerService.delete(req.params.id as string); res.json({ status: 'OK', message: 'Đã xóa banner.' }); }
    catch (error) { sendError(res, error); }
  };
}

export default new BannerController();
