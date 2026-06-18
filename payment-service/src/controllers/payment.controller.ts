// ========================
// Payment Controller
// Mục đích:
// - nhận request HTTP từ gateway
// - validate input cơ bản
// - gọi paymentService và trả response thống nhất
// Hàm chính:
// - courseCheckout()
// - getTransaction()
// - getTransactionByCode()
// - webhookVnpay()
// - webhookMomo()
// - momoBrowserReturn()
// - momoReturn()
// ========================

import { Request, Response } from 'express';
import paymentService from '../services/payment.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { PaymentMethod, PaymentProvider } from '@securelearn/common';

class PaymentController {
  public async courseCheckout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { paymentMethod, provider } = req.body as { paymentMethod?: PaymentMethod; provider?: PaymentProvider };
      if (!paymentMethod) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng chọn phương thức thanh toán.' });
        return;
      }

      const authHeader = req.header('Authorization');
      if (!authHeader) {
        res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
        return;
      }

      const result = await paymentService.createCourseCheckout(
        {
          userId: req.userId!,
          userRole: req.userRole!,
          fullName: req.userName || '',
          email: req.userEmail || '',
        },
        authHeader,
        { paymentMethod, provider },
        String(req.headers['x-forwarded-for'] || req.ip || '127.0.0.1').split(',')[0].trim()
      );

      res.status(201).json({
        status: 'OK',
        message: 'Tạo phiên thanh toán thành công.',
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getTransaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const transaction = await paymentService.getTransactionForUser(String(req.params.id || ''), req.userId!, req.userRole);
      res.status(200).json({ status: 'OK', data: transaction });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 404;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async getTransactionByCode(req: AuthRequest, res: Response): Promise<void> {
    try {
      const transactionCode = String(req.params.transactionCode || '');
      if (!transactionCode) {
        res.status(400).json({ status: 'ERR', message: 'Thiếu transactionCode.' });
        return;
      }

      const transaction = await paymentService.getTransactionByCodeForUser(transactionCode, req.userId!, req.userRole);
      res.status(200).json({ status: 'OK', data: transaction });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async getMyTransactions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await paymentService.getMyTransactions(req.userId!, req.userRole, {
        search: String(req.query.search || ''),
        productType: String(req.query.productType || ''),
        status: String(req.query.status || ''),
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
      });
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      const status = error.message.includes('Admin') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async webhookVnpay(req: Request, res: Response): Promise<void> {
    try {
      const payload = {
        ...(req.query as Record<string, unknown>),
        ...(req.body as Record<string, unknown>),
      };
      const result = await paymentService.handleVnpayIpn(payload);
      res.status(200).json({
        RspCode: result.rspCode,
        Message: result.message,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async webhookMomo(req: Request, res: Response): Promise<void> {
    try {
      const payload = {
        ...(req.query as Record<string, unknown>),
        ...(req.body as Record<string, unknown>),
      };
      await paymentService.handleMomoIpn(payload);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public momoBrowserReturn(req: Request, res: Response): void {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const sourceUrl = new URL(req.originalUrl, 'http://payment-service.local');
    const targetUrl = new URL('/payment/momo-return', clientUrl);

    // Giữ nguyên query do MoMo gửi để frontend chuyển tiếp cho bước xác minh chữ ký.
    targetUrl.search = sourceUrl.search;
    res.redirect(302, targetUrl.toString());
  }

  public async vnpayReturn(req: AuthRequest, res: Response): Promise<void> {
    try {
      const payload = {
        ...(req.query as Record<string, unknown>),
        ...(req.body as Record<string, unknown>),
      };
      const result = await paymentService.handleVnpayReturn(payload);
      res.status(200).json({
        status: 'OK',
        message: 'Xác nhận thanh toán VNPay thành công.',
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async momoReturn(req: AuthRequest, res: Response): Promise<void> {
    try {
      const payload = {
        ...(req.query as Record<string, unknown>),
        ...(req.body as Record<string, unknown>),
      };
      const result = await paymentService.handleMomoReturn(payload);
      res.status(200).json({
        status: 'OK',
        message: 'Xác nhận thanh toán MoMo thành công.',
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new PaymentController();
