import { Response } from 'express';
import wishlistService from '../services/wishlist.service';
import { AuthRequest } from '../middlewares/auth.middleware';

class WishlistController {
  public async getWishlist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const wishlist = await wishlistService.getWishlist(req.userId!);
      res.status(200).json({ status: 'OK', data: wishlist });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async addItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const wishlist = await wishlistService.addItem(req.userId!, req.body.courseId, req.userRole);
      res.status(200).json({ status: 'OK', message: 'Đã lưu khóa học vào danh sách mong muốn.', data: wishlist });
    } catch (error: any) {
      const status =
        error.message.includes('chính mình') ? 403 :
        error.message.includes('không tồn tại') ? 404 :
        error.message.includes('không hợp lệ') || error.message.includes('chưa được xuất bản') ? 400 : 500;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async removeItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const wishlist = await wishlistService.removeItem(req.userId!, req.params.courseId as string);
      res.status(200).json({ status: 'OK', message: 'Đã bỏ khóa học khỏi danh sách mong muốn.', data: wishlist });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async mergeGuestWishlist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const courseIds = Array.isArray(req.body.courseIds) ? req.body.courseIds : [];
      const wishlist = await wishlistService.mergeGuestWishlist(req.userId!, courseIds, req.userRole);
      res.status(200).json({ status: 'OK', message: 'Đã gộp danh sách mong muốn.', data: wishlist });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async clearWishlist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const wishlist = await wishlistService.clearWishlist(req.userId!);
      res.status(200).json({ status: 'OK', message: 'Đã xóa danh sách mong muốn.', data: wishlist });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new WishlistController();
