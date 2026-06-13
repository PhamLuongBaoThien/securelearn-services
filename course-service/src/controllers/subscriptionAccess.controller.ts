// ========================
// Subscription Access Controller
// Mục đích:
// - mở API opt-in catalog, enroll bằng thuê bao, entitlement và heartbeat
// - làm cổng HTTP cho learner/instructor/admin trước khi vào service entitlement
// ========================
import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import subscriptionAccessService from '../services/subscriptionAccess.service';

class SubscriptionAccessController {
  public catalog = async (_req: Request, res: Response) => {
    try {
      res.status(200).json({ status: 'OK', data: await subscriptionAccessService.catalog() });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };

  public optIn = async (req: AuthRequest, res: Response) => {
    try {
      const data = await subscriptionAccessService.optIn(String(req.params.id), req.userId!);
      res.status(200).json({ status: 'OK', message: 'Đã gửi khóa học vào catalog thuê bao để Admin duyệt.', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public withdraw = async (req: AuthRequest, res: Response) => {
    try {
      const data = await subscriptionAccessService.withdraw(
        String(req.params.id),
        req.userId!,
        String(req.body.reason || '')
      );
      res.status(200).json({ status: 'OK', message: 'Đã rút khóa học khỏi catalog thuê bao.', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public review = async (req: AuthRequest, res: Response) => {
    try {
      const data = await subscriptionAccessService.review(
        String(req.params.id),
        req.body.action,
        String(req.body.reason || '')
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };

  public enroll = async (req: AuthRequest, res: Response) => {
    try {
      const data = await subscriptionAccessService.enroll(req.userId!, req.userRole!, String(req.params.id));
      res.status(201).json({ status: 'OK', message: 'Đã mở khóa học bằng gói thuê bao.', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };

  public entitlement = async (req: AuthRequest, res: Response) => {
    try {
      const data = await subscriptionAccessService.entitlement(req.userId!, String(req.params.id));
      res.status(data.allowed ? 200 : 403).json({ status: data.allowed ? 'OK' : 'ERR', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };

  public heartbeat = async (req: AuthRequest, res: Response) => {
    try {
      const data = await subscriptionAccessService.heartbeat(req.userId!, req.body);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  };
}

export default new SubscriptionAccessController();
