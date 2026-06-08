// Payment Routes
// Mục đích:
// - định nghĩa public/protected endpoints cho payment-service
// - tách route theo đúng flow checkout / confirm / webhook
// Routes chính:
// - POST /course-checkout
// - GET /transactions/code/:transactionCode
// - GET /transactions/:id
// - GET|POST /webhooks/vnpay
// - GET|POST /webhooks/momo
// - GET|POST /vnpay-return
// - GET|POST /momo-return

import { Router } from 'express';
import paymentController from '../controllers/payment.controller';
import { extractUser } from '../middlewares/auth.middleware';

const router = Router();
// Route cho checkout khóa học
router.post('/course-checkout', extractUser, paymentController.courseCheckout);
// Route cụ thể phải đặt trước route :id để tránh bị match nhầm
router.get('/transactions/code/:transactionCode', extractUser, paymentController.getTransactionByCode);
// Route để lấy thông tin giao dịch
router.get('/transactions/:id', extractUser, paymentController.getTransaction);
// Route để xử lý IPN từ VNPay
router.get('/webhooks/vnpay', paymentController.webhookVnpay);
router.post('/webhooks/vnpay', paymentController.webhookVnpay);

// Route để xử lý IPN từ MoMo
router.get('/webhooks/momo', paymentController.webhookMomo);
router.post('/webhooks/momo', paymentController.webhookMomo);

// Route để xử lý Return URL từ client-side
router.get('/vnpay-return', extractUser, paymentController.vnpayReturn);
router.post('/vnpay-return', extractUser, paymentController.vnpayReturn);
router.get('/momo-return', extractUser, paymentController.momoReturn);
router.post('/momo-return', extractUser, paymentController.momoReturn);

export default router;
