import { Response } from 'express';
import cartService from '../services/cart.service';
import { AuthRequest } from '../middlewares/auth.middleware';

class CartController {
  public async getCart(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cart = await cartService.getCart(req.userId!);
      res.status(200).json({ status: 'OK', data: cart });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async getBuyNowItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const item = await cartService.getBuyNowItem(req.userId!, String(req.params.courseId || ''), req.userRole);
      res.status(200).json({ status: 'OK', data: { item } });
    } catch (error: any) {
      if (error.name === 'CourseAlreadyOwnedError') {
        res.status(409).json({
          status: 'ERR',
          code: 'COURSE_ALREADY_OWNED',
          message: error.message,
          data: { courseId: String(req.params.courseId || ''), slug: error.courseSlug || '' },
        });
        return;
      }
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async addItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cart = await cartService.addItem(req.userId!, req.body.courseId, req.userRole);
      res.status(200).json({ status: 'OK', message: 'Đã thêm khóa học vào giỏ hàng.', data: cart });
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
      const cart = await cartService.removeItem(req.userId!, req.params.courseId as string);
      res.status(200).json({ status: 'OK', message: 'Đã bỏ khóa học khỏi giỏ hàng.', data: cart });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async mergeGuestCart(req: AuthRequest, res: Response): Promise<void> {
    try {
      const courseIds = Array.isArray(req.body.courseIds) ? req.body.courseIds : [];
      const cart = await cartService.mergeGuestCart(req.userId!, courseIds, req.userRole);
      res.status(200).json({ status: 'OK', message: 'Đã gộp giỏ hàng.', data: cart });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async clearCart(req: AuthRequest, res: Response): Promise<void> {
    try {
      const cart = await cartService.clearCart(req.userId!);
      res.status(200).json({ status: 'OK', message: 'Đã xóa giỏ hàng.', data: cart });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new CartController();
