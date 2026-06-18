// ========================
// Payment Routes
// Mục đích:
// - gom toàn bộ endpoint checkout, webhook, finance và subscription của payment-service
// - tách rõ route public, route có auth và route nội bộ để các flow thanh toán dễ theo dõi
// ========================
import { Router } from 'express';
import paymentController from '../controllers/payment.controller';
import financeController from '../controllers/finance.controller';
import subscriptionController from '../controllers/subscription.controller';
import { extractUser, requirePermission, requireRoles } from '../middlewares/auth.middleware';

const router = Router();
// Route cho checkout khóa học
router.post('/course-checkout', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), paymentController.courseCheckout);
// Nhóm route mới cho thuê bao: tách riêng khỏi mua khóa học để dễ quản trị quyền và settlement.
router.get('/subscription-plans', subscriptionController.plans);
router.post('/subscription-checkout', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), subscriptionController.checkout);
router.get('/subscriptions/me', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), subscriptionController.me);
// Route cụ thể phải đặt trước route :id để tránh bị match nhầm
router.get('/transactions/me', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), paymentController.getMyTransactions);
router.get('/transactions/code/:transactionCode', extractUser, paymentController.getTransactionByCode);
// Route để lấy thông tin giao dịch
router.get('/transactions/:id', extractUser, paymentController.getTransaction);

// Finance: Admin config/report
router.get('/admin/finance/split-config', extractUser, requirePermission('finance:read'), financeController.getSplitConfig);
router.put('/admin/finance/split-config', extractUser, requirePermission('finance:manage'), financeController.updateSplitConfig);
router.get('/admin/finance/revenue', extractUser, requirePermission('finance:read'), financeController.getAdminRevenue);
router.get('/admin/finance/transactions', extractUser, requirePermission('finance:read'), financeController.getAdminTransactions);

// Finance: Instructor report
router.get('/instructor/finance/revenue', extractUser, requireRoles('INSTRUCTOR'), financeController.getInstructorRevenue);
router.get('/instructor/finance/subscriptions', extractUser, requireRoles('INSTRUCTOR'), subscriptionController.instructorFinance);

router.get('/admin/subscription-plans', extractUser, requirePermission('finance:read'), subscriptionController.adminPlans);
router.put('/admin/subscription-plans', extractUser, requirePermission('finance:manage'), subscriptionController.upsertPlan);
router.get('/admin/subscriptions/terms', extractUser, requirePermission('finance:read'), subscriptionController.adminTerms);
router.post('/admin/subscriptions/terms/:termId/refund', extractUser, requirePermission('finance:manage'), subscriptionController.refund);
router.get('/admin/subscriptions/settlements', extractUser, requirePermission('finance:read'), subscriptionController.settlements);
router.post('/admin/subscriptions/settlements/:period/calculate', extractUser, requirePermission('finance:manage'), subscriptionController.calculateSettlement);
router.patch('/admin/subscriptions/settlements/:period/status', extractUser, requirePermission('finance:manage'), subscriptionController.updateSettlementStatus);

// Route để xử lý IPN từ VNPay
router.get('/webhooks/vnpay', paymentController.webhookVnpay);
router.post('/webhooks/vnpay', paymentController.webhookVnpay);

// Route để xử lý IPN từ MoMo
router.get('/webhooks/momo', paymentController.webhookMomo);
router.post('/webhooks/momo', paymentController.webhookMomo);

// MoMo/Napas quay về HTTPS public trước, sau đó endpoint này chuyển trình duyệt về frontend.
router.get('/momo-browser-return', paymentController.momoBrowserReturn);

// Route để xử lý Return URL từ client-side
router.get('/vnpay-return', extractUser, paymentController.vnpayReturn);
router.post('/vnpay-return', extractUser, paymentController.vnpayReturn);
router.get('/momo-return', extractUser, paymentController.momoReturn);
router.post('/momo-return', extractUser, paymentController.momoReturn);

export default router;
