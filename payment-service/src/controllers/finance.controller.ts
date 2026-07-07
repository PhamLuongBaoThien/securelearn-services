import { Response } from 'express';
import paymentService from '../services/payment.service';
import { AuthRequest } from '../middlewares/auth.middleware';

class FinanceController {
  constructor() {
    this.getSplitConfig = this.getSplitConfig.bind(this);
    this.updateSplitConfig = this.updateSplitConfig.bind(this);
    this.getAdminRevenue = this.getAdminRevenue.bind(this);
    this.getAdminTransactions = this.getAdminTransactions.bind(this);
    this.getInstructorRevenue = this.getInstructorRevenue.bind(this);
  }

  private ensureAdmin(req: AuthRequest): void {
    if (req.userRole !== 'ADMIN') {
      throw new Error('Bạn không có quyền truy cập mục tài chính của Admin.');
    }
  }

  private ensureInstructor(req: AuthRequest): void {
    if (req.userRole !== 'INSTRUCTOR') {
      throw new Error('Bạn không có quyền truy cập mục tài chính của Instructor.');
    }
  }

  public async getSplitConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      this.ensureAdmin(req);
      const productType = req.query.productType === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'COURSE';
      const data = await paymentService.getFinanceSplitConfig(productType);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  }

  public async updateSplitConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      this.ensureAdmin(req);
      const { adminPercent, instructorPercent } = req.body as { adminPercent?: number; instructorPercent?: number };
      const productType = req.query.productType === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'COURSE';
      const data = await paymentService.updateFinanceSplitConfig({
        adminPercent: Number(adminPercent),
        instructorPercent: Number(instructorPercent),
      }, productType);
      res.status(200).json({ status: 'OK', message: 'Đã cập nhật cấu hình chia doanh thu.', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getAdminRevenue(req: AuthRequest, res: Response): Promise<void> {
    try {
      this.ensureAdmin(req);
      const data = await paymentService.getAdminFinanceOverview({
        search: String(req.query.search || ''),
        startDate: String(req.query.startDate || ''),
        endDate: String(req.query.endDate || ''),
        provider: String(req.query.provider || ''),
        status: String(req.query.status || ''),
        productType: req.query.productType === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : req.query.productType === 'COURSE' ? 'COURSE' : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
      });
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getAdminTransactions(req: AuthRequest, res: Response): Promise<void> {
    try {
      this.ensureAdmin(req);
      const data = await paymentService.getAdminFinanceOverview({
        search: String(req.query.search || ''),
        startDate: String(req.query.startDate || ''),
        endDate: String(req.query.endDate || ''),
        provider: String(req.query.provider || ''),
        status: String(req.query.status || ''),
        sort: String(req.query.sort || 'newest'),
        productType: req.query.productType === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : req.query.productType === 'COURSE' ? 'COURSE' : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
      });
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getInstructorRevenue(req: AuthRequest, res: Response): Promise<void> {
    try {
      this.ensureInstructor(req);
      const data = await paymentService.getInstructorFinanceOverview(req.userId!, {
        startDate: String(req.query.startDate || ''),
        endDate: String(req.query.endDate || ''),
      });
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new FinanceController();
