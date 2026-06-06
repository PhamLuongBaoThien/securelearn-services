// Payment Routes
// Mục đích:
// - định nghĩa public/protected endpoints cho payment-service
// - tách route theo đúng flow checkout / confirm / webhook

import { Router } from 'express';
import paymentController from '../controllers/payment.controller';
import { extractUser } from '../middlewares/auth.middleware';

const router = Router();
// Route cho checkout khóa học
router.post('/course-checkout', extractUser, paymentController.courseCheckout);
// Route để lấy thông tin giao dịch
router.get('/transactions/:id', extractUser, paymentController.getTransaction);
// Route để xác nhận giao dịch sau khi thanh toán thành công
router.post('/confirm', extractUser, paymentController.confirm);
// Route để xử lý webhook từ các nhà cung cấp thanh toán
router.post('/webhooks/:provider', paymentController.webhook);

export default router;
