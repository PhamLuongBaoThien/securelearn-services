// Payment Controller
// Mục đích:
// - nhận request HTTP từ gateway
// - validate input cơ bản
// - gọi paymentService và trả response thống nhất
// Hàm chính:
// - courseCheckout()
// - getTransaction()
// - confirm()
// - webhook()

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
        { paymentMethod, provider }
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

  public async confirm(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { transactionId, providerRef } = req.body as { transactionId?: string; providerRef?: string };
      if (!transactionId) {
        res.status(400).json({ status: 'ERR', message: 'Thiếu transactionId.' });
        return;
      }

      const transaction = await paymentService.confirmTransaction(String(transactionId), {
        userId: req.userId!,
        userRole: req.userRole!,
        fullName: req.userName || '',
        email: req.userEmail || '',
      }, providerRef);

      res.status(200).json({
        status: 'OK',
        message: 'Thanh toán thành công.',
        data: transaction,
      });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async webhook(req: AuthRequest, res: Response): Promise<void> {
    try {
      const provider = String(req.params.provider || '').toUpperCase() as PaymentProvider;
      const transaction = await paymentService.handleWebhook(provider, req.body as Record<string, unknown>);
      res.status(200).json({
        status: 'OK',
        message: 'Webhook đã được xử lý.',
        data: transaction,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new PaymentController();
