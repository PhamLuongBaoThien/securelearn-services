// ========================
// Coupon Controller
// Mục đích:
// - nhận request HTTP cho coupon từ learner và Admin Finance
// - giữ controller mỏng: parse input cơ bản rồi chuyển sang coupon/payment service
// Hàm chính:
// - listAdmin()
// - create()/update()/updateStatus()/delete()
// - validate()/available()/best()/bestPreview()/bestPreviews()
// - stats()/redemptions()
// ========================
import { Response } from 'express';
import couponService, { CouponInput } from '../services/coupon.service';
import paymentService from '../services/payment.service';
import { AuthRequest } from '../middlewares/auth.middleware';

class CouponController {
  public async listAdmin(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await couponService.listAdminCoupons({
        search: String(req.query.search || ''),
        status: String(req.query.status || ''),
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      });
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const actorName = req.userName || req.userEmail || req.userId || '';
      const data = await couponService.createCoupon(req.body as CouponInput, req.userId || '', actorName);
      res.status(201).json({ status: 'OK', message: 'Đã tạo coupon.', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const actorName = req.userName || req.userEmail || req.userId || '';
      const data = await couponService.updateCoupon(String(req.params.id || ''), req.body as Partial<CouponInput>, req.userId || '', actorName);
      res.status(200).json({ status: 'OK', message: 'Đã cập nhật coupon.', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async updateStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const actorName = req.userName || req.userEmail || req.userId || '';
      const data = await couponService.updateStatus(String(req.params.id || ''), Boolean(req.body.isActive), req.userId || '', actorName);
      res.status(200).json({ status: 'OK', message: 'Đã cập nhật trạng thái coupon.', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await couponService.deleteCoupon(String(req.params.id || ''));
      res.status(200).json({ status: 'OK', message: 'Đã xóa coupon.' });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async validate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const authHeader = req.header('Authorization');
      if (!authHeader) {
        res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
        return;
      }
      const data = await paymentService.validateCourseCoupon(
        req.userId!,
        authHeader,
        String(req.body.code || '')
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async available(req: AuthRequest, res: Response): Promise<void> {
    try {
      const authHeader = req.header('Authorization');
      if (!authHeader) {
        res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
        return;
      }
      const data = await paymentService.getAvailableCourseCoupons(req.userId!, authHeader);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async best(req: AuthRequest, res: Response): Promise<void> {
    try {
      const authHeader = req.header('Authorization');
      if (!authHeader) {
        res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
        return;
      }
      const data = await paymentService.getBestCourseCoupon(req.userId!, authHeader);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }


  public async bestPreview(req: AuthRequest, res: Response): Promise<void> {
    try {
      const amount = Number(req.query.amount || 0);
      const data = await couponService.getBestCouponPreview(amount, req.userId);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async bestPreviews(req: AuthRequest, res: Response): Promise<void> {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const data = await couponService.getBestCouponPreviews(items, req.userId);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
  public async stats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await couponService.getCouponStats();
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async couponStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await couponService.getCouponStats(String(req.params.id || ''));
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async redemptions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await couponService.listRedemptions({
        code: String(req.query.code || ''),
        user: String(req.query.user || ''),
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      });
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async couponRedemptions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await couponService.listRedemptions({
        couponId: String(req.params.id || ''),
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      });
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new CouponController();



