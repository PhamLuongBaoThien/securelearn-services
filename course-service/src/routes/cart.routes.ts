import { Router } from 'express';
import cartController from '../controllers/cart.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router();

// Bảo vệ toàn bộ giỏ hàng bằng JWT của STUDENT hoặc INSTRUCTOR.
router.use(extractUser, requireStudentOrInstructor);

// [GET] /api/cart — Lấy giỏ hàng hiện tại kèm thông tin khóa học còn khả dụng.
router.get('/', cartController.getCart);
// [GET] /api/cart/buy-now/:courseId — Chuẩn bị một khóa làm dữ liệu checkout mua ngay.
router.get('/buy-now/:courseId', cartController.getBuyNowItem);
// [POST] /api/cart/items — Thêm một khóa học hợp lệ vào giỏ.
router.post('/items', cartController.addItem);
// [DELETE] /api/cart/items/:courseId — Xóa một khóa học khỏi giỏ.
router.delete('/items/:courseId', cartController.removeItem);
// [POST] /api/cart/merge — Gộp giỏ lưu ở trình duyệt vào giỏ tài khoản sau đăng nhập.
router.post('/merge', cartController.mergeGuestCart);
// [DELETE] /api/cart — Xóa toàn bộ khóa học trong giỏ hiện tại.
router.delete('/', cartController.clearCart);

export default router;
