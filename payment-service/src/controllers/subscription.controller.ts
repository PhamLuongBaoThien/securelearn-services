// ========================
// Subscription Controller
// Mục đích:
// - mở API public/admin cho gói thuê bao
// - nhận checkout thuê bao, settlement và refund
// - giữ controller mỏng, dồn nghiệp vụ về subscriptionService/paymentService
// ========================
import { Request, Response } from 'express';
import { PaymentMethod, PaymentProvider } from '@securelearn/common';
import { AuthRequest } from '../middlewares/auth.middleware';
import paymentService from '../services/payment.service';
import subscriptionService from '../services/subscription.service';

class SubscriptionController {
  private ensureAdmin(req: AuthRequest) {
    if (req.userRole !== 'ADMIN') throw new Error('Bạn không có quyền quản lý thuê bao.');
  }

  public plans = async (_req: Request, res: Response) => {
    try {
      res.status(200).json({ status: 'OK', data: await subscriptionService.getPublicPlans() });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };

  public checkout = async (req: AuthRequest, res: Response) => {
    try {
      const { planId, paymentMethod, provider } = req.body as {
        planId?: string;
        paymentMethod?: PaymentMethod;
        provider?: PaymentProvider;
      };
      if (!planId || !paymentMethod) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng chọn gói và phương thức thanh toán.' });
        return;
      }
      const data = await paymentService.createSubscriptionCheckout(
        {
          userId: req.userId!,
          userRole: req.userRole!,
          fullName: req.userName || '',
          email: req.userEmail || '',
        },
        { planId, paymentMethod, provider },
        String(req.headers['x-forwarded-for'] || req.ip || '127.0.0.1').split(',')[0].trim()
      );
      res.status(201).json({ status: 'OK', message: 'Tạo phiên thanh toán thuê bao thành công.', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };

  public me = async (req: AuthRequest, res: Response) => {
    try {
      res.status(200).json({ status: 'OK', data: await subscriptionService.getUserSubscription(req.userId!) });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };

  public adminPlans = async (req: AuthRequest, res: Response) => {
    try {
      this.ensureAdmin(req);
      res.status(200).json({ status: 'OK', data: await subscriptionService.getAdminPlans() });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public upsertPlan = async (req: AuthRequest, res: Response) => {
    try {
      this.ensureAdmin(req);
      const data = await subscriptionService.upsertPlan(req.body, req.userId!);
      res.status(200).json({ status: 'OK', message: 'Đã lưu gói thuê bao.', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public adminTerms = async (req: AuthRequest, res: Response) => {
    try {
      this.ensureAdmin(req);
      res.status(200).json({ status: 'OK', data: await subscriptionService.getAdminTerms() });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public refund = async (req: AuthRequest, res: Response) => {
    try {
      this.ensureAdmin(req);
      const data = await subscriptionService.refundTerm(String(req.params.termId), req.userId!, String(req.body.reason || 'Admin manual refund'));
      res.status(200).json({ status: 'OK', message: 'Đã ghi nhận hoàn tiền và thu hồi kỳ thuê bao.', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public calculateSettlement = async (req: AuthRequest, res: Response) => {
    try {
      this.ensureAdmin(req);
      const data = await subscriptionService.calculateSettlement(String(req.params.period), req.userId!);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public updateSettlementStatus = async (req: AuthRequest, res: Response) => {
    try {
      this.ensureAdmin(req);
      const data = await subscriptionService.updateSettlementStatus(String(req.params.period), req.body.status, req.userId!);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public settlements = async (req: AuthRequest, res: Response) => {
    try {
      this.ensureAdmin(req);
      res.status(200).json({ status: 'OK', data: await subscriptionService.getSettlements() });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public instructorFinance = async (req: AuthRequest, res: Response) => {
    try {
      if (req.userRole !== 'INSTRUCTOR') throw new Error('Bạn không có quyền xem báo cáo Instructor.');
      res.status(200).json({ status: 'OK', data: await subscriptionService.getInstructorFinance(req.userId!) });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

}

export default new SubscriptionController();
