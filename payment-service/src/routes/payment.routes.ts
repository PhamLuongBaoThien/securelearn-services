// ========================
// Payment Routes
// Mục đích:
// - gom toàn bộ endpoint checkout, webhook, finance, coupon và subscription của payment-service
// - tách rõ route public, route có auth và route nội bộ để các flow thanh toán dễ theo dõi
// ========================
import { Router } from 'express';
import paymentController from '../controllers/payment.controller';
import financeController from '../controllers/finance.controller';
import subscriptionController from '../controllers/subscription.controller';
import couponController from '../controllers/coupon.controller';
import { extractUser, optionalExtractUser, requirePermission, requireRoles } from '../middlewares/auth.middleware';

const router = Router();
// [POST] /api/payments/course-checkout — Tạo giao dịch mua khóa, áp mã giảm giá và sinh URL thanh toán qua cổng đã chọn.
router.post('/course-checkout', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), paymentController.courseCheckout);
// [POST] /api/payments/coupons/validate — Kiểm tra mã coupon với user, khóa học và giá trị đơn hàng hiện tại.
router.post('/coupons/validate', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), couponController.validate);
// [GET] /api/payments/coupons/available — Liệt kê coupon người dùng có thể áp dụng cho checkout.
router.get('/coupons/available', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), couponController.available);
// [GET] /api/payments/coupons/best — Chọn coupon hợp lệ mang lại mức giảm tốt nhất cho người dùng.
router.get('/coupons/best', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), couponController.best);
// [GET] /api/payments/coupons/best-preview — Xem trước coupon tốt nhất cho một khóa, hỗ trợ cả khách chưa đăng nhập.
router.get('/coupons/best-preview', optionalExtractUser, couponController.bestPreview);
// [POST] /api/payments/coupons/best-previews — Xem trước coupon tốt nhất cho nhiều khóa trong một request.
router.post('/coupons/best-previews', optionalExtractUser, couponController.bestPreviews);
// Nhóm route mới cho thuê bao: tách riêng khỏi mua khóa học để dễ quản trị quyền và settlement.
// [GET] /api/payments/subscription-plans — Công khai các gói thuê bao đang mở bán.
router.get('/subscription-plans', subscriptionController.plans);
// [POST] /api/payments/subscription-checkout — Tạo giao dịch mua/gia hạn gói thuê bao.
router.post('/subscription-checkout', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), subscriptionController.checkout);
// [GET] /api/payments/subscriptions/me — Lấy trạng thái, thời hạn và quyền thuê bao của người dùng.
router.get('/subscriptions/me', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), subscriptionController.me);
// Route cụ thể phải đặt trước route :id để tránh bị match nhầm
// [GET] /api/payments/transactions/me — Liệt kê lịch sử giao dịch của người dùng hiện tại.
router.get('/transactions/me', extractUser, requireRoles('STUDENT', 'INSTRUCTOR'), paymentController.getMyTransactions);
// [GET] /api/payments/transactions/code/:transactionCode — Tra cứu giao dịch theo mã hiển thị cho khách hàng.
router.get('/transactions/code/:transactionCode', extractUser, paymentController.getTransactionByCode);
// [GET] /api/payments/transactions/:id — Lấy chi tiết một giao dịch người dùng được phép xem.
router.get('/transactions/:id', extractUser, paymentController.getTransaction);

// Finance: Admin config/report
// [GET] /api/payments/admin/finance/split-config — Đọc cấu hình tỷ lệ phân chia doanh thu hiện tại.
router.get('/admin/finance/split-config', extractUser, requirePermission('finance:read'), financeController.getSplitConfig);
// [PUT] /api/payments/admin/finance/split-config — Cập nhật tỷ lệ chia doanh thu áp dụng cho giao dịch mới.
router.put('/admin/finance/split-config', extractUser, requirePermission('finance:manage'), financeController.updateSplitConfig);
// [GET] /api/payments/admin/finance/revenue — Tổng hợp doanh thu nền tảng theo khoảng thời gian/bộ lọc.
router.get('/admin/finance/revenue', extractUser, requirePermission('finance:read'), financeController.getAdminRevenue);
// [GET] /api/payments/admin/finance/transactions — Admin tra cứu, lọc và phân trang toàn bộ giao dịch.
router.get('/admin/finance/transactions', extractUser, requirePermission('finance:read'), financeController.getAdminTransactions);

// [GET] /api/payments/admin/coupons/stats — Tổng hợp số lượng, trạng thái và hiệu quả coupon.
router.get('/admin/coupons/stats', extractUser, requirePermission('finance:read'), couponController.stats);
// [GET] /api/payments/admin/coupon-redemptions — Liệt kê lịch sử sử dụng coupon trên các giao dịch.
router.get('/admin/coupon-redemptions', extractUser, requirePermission('finance:read'), couponController.redemptions);
// [POST] /api/payments/admin/coupons/multi-delete — Xóa đồng loạt nhiều coupon đủ điều kiện.
router.post('/admin/coupons/multi-delete', extractUser, requirePermission('finance:manage'), couponController.multiDelete);
// [PATCH] /api/payments/admin/coupons/multi-status — Bật/tắt trạng thái nhiều coupon.
router.patch('/admin/coupons/multi-status', extractUser, requirePermission('finance:manage'), couponController.multiUpdateStatus);
// [GET] /api/payments/admin/coupons/:id/stats — Xem thống kê sử dụng của một coupon.
router.get('/admin/coupons/:id/stats', extractUser, requirePermission('finance:read'), couponController.couponStats);
// [GET] /api/payments/admin/coupons/:id/redemptions — Xem các lượt sử dụng của một coupon cụ thể.
router.get('/admin/coupons/:id/redemptions', extractUser, requirePermission('finance:read'), couponController.couponRedemptions);
// [GET] /api/payments/admin/coupons — Admin liệt kê và lọc toàn bộ coupon.
router.get('/admin/coupons', extractUser, requirePermission('finance:read'), couponController.listAdmin);
// [POST] /api/payments/admin/coupons — Tạo coupon và cấu hình phạm vi/điều kiện áp dụng.
router.post('/admin/coupons', extractUser, requirePermission('finance:manage'), couponController.create);
// [PATCH] /api/payments/admin/coupons/:id — Cập nhật thông tin và điều kiện của coupon.
router.patch('/admin/coupons/:id', extractUser, requirePermission('finance:manage'), couponController.update);
// [PATCH] /api/payments/admin/coupons/:id/status — Bật hoặc tắt một coupon cụ thể.
router.patch('/admin/coupons/:id/status', extractUser, requirePermission('finance:manage'), couponController.updateStatus);
// [DELETE] /api/payments/admin/coupons/:id — Xóa coupon đủ điều kiện khỏi hệ thống.
router.delete('/admin/coupons/:id', extractUser, requirePermission('finance:manage'), couponController.delete);

// Finance: Instructor report
// [GET] /api/payments/instructor/finance/revenue — Giảng viên xem doanh thu từ các khóa mình sở hữu.
router.get('/instructor/finance/revenue', extractUser, requireRoles('INSTRUCTOR'), financeController.getInstructorRevenue);
// [GET] /api/payments/instructor/finance/subscriptions — Giảng viên xem doanh thu/giây học đủ chuẩn từ thuê bao.
router.get('/instructor/finance/subscriptions', extractUser, requireRoles('INSTRUCTOR'), subscriptionController.instructorFinance);

// [GET] /api/payments/admin/subscription-plans — Admin xem tất cả gói thuê bao, gồm gói ngừng bán.
router.get('/admin/subscription-plans', extractUser, requirePermission('finance:read'), subscriptionController.adminPlans);
// [PUT] /api/payments/admin/subscription-plans — Tạo hoặc cập nhật cấu hình một gói thuê bao.
router.put('/admin/subscription-plans', extractUser, requirePermission('finance:manage'), subscriptionController.upsertPlan);
// [GET] /api/payments/admin/subscriptions/terms — Admin tra cứu các kỳ/quyền thuê bao đã phát sinh.
router.get('/admin/subscriptions/terms', extractUser, requirePermission('finance:read'), subscriptionController.adminTerms);
// [GET] /api/payments/admin/subscriptions/settlements — Tổng hợp đối soát doanh thu thuê bao theo kỳ.
router.get('/admin/subscriptions/settlements', extractUser, requirePermission('finance:read'), subscriptionController.settlements);
// [PATCH] /api/payments/admin/subscriptions/settlements/:period/status — Cập nhật trạng thái xử lý đối soát của một kỳ.
router.patch('/admin/subscriptions/settlements/:period/status', extractUser, requirePermission('finance:manage'), subscriptionController.updateSettlementStatus);

// [GET] /api/payments/webhooks/vnpay — Nhận IPN VNPay, xác minh chữ ký và chốt trạng thái giao dịch (tương thích GET).
router.get('/webhooks/vnpay', paymentController.webhookVnpay);
// [POST] /api/payments/webhooks/vnpay — Nhận IPN VNPay dạng POST và xử lý idempotent.
router.post('/webhooks/vnpay', paymentController.webhookVnpay);

// [GET] /api/payments/webhooks/momo — Nhận callback MoMo dạng GET, xác minh và cập nhật giao dịch.
router.get('/webhooks/momo', paymentController.webhookMomo);
// [POST] /api/payments/webhooks/momo — Nhận IPN MoMo dạng POST, xác minh chữ ký và xử lý idempotent.
router.post('/webhooks/momo', paymentController.webhookMomo);

// [GET] /api/payments/momo-browser-return — Nhận người dùng quay về từ MoMo/Napas rồi chuyển hướng về frontend.
router.get('/momo-browser-return', paymentController.momoBrowserReturn);

// Route để xử lý Return URL từ client-side
// [GET] /api/payments/vnpay-return — Xác minh dữ liệu VNPay trả về và trả kết quả giao dịch cho user.
router.get('/vnpay-return', extractUser, paymentController.vnpayReturn);
// [POST] /api/payments/vnpay-return — Biến thể POST của return flow VNPay.
router.post('/vnpay-return', extractUser, paymentController.vnpayReturn);
// [GET] /api/payments/momo-return — Xác minh kết quả MoMo trả về cho người dùng đăng nhập.
router.get('/momo-return', extractUser, paymentController.momoReturn);
// [POST] /api/payments/momo-return — Biến thể POST của return flow MoMo.
router.post('/momo-return', extractUser, paymentController.momoReturn);

export default router;



