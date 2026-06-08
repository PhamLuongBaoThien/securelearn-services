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
// ========================

import { Response } from 'express';
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
      const transaction = await paymentService.getTransactionForUser(String(req.params.id || ''), req.userId!);
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

      const transaction = await paymentService.getTransactionByCodeForUser(transactionCode, req.userId!);
      res.status(200).json({ status: 'OK', data: transaction });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async webhookVnpay(req: AuthRequest, res: Response): Promise<void> {
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
}

export default new PaymentController();
