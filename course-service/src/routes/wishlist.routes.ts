import { Router } from 'express';
import wishlistController from '../controllers/wishlist.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router();

// Bảo vệ toàn bộ wishlist bằng JWT của STUDENT hoặc INSTRUCTOR.
router.use(extractUser, requireStudentOrInstructor);

// [GET] /api/wishlist — Lấy danh sách khóa học yêu thích của người dùng.
router.get('/', wishlistController.getWishlist);
// [POST] /api/wishlist/items — Thêm một khóa học vào danh sách yêu thích.
router.post('/items', wishlistController.addItem);
// [DELETE] /api/wishlist/items/:courseId — Bỏ một khóa học khỏi danh sách yêu thích.
router.delete('/items/:courseId', wishlistController.removeItem);
// [POST] /api/wishlist/merge — Gộp wishlist của khách vào tài khoản sau đăng nhập.
router.post('/merge', wishlistController.mergeGuestWishlist);
// [DELETE] /api/wishlist — Xóa toàn bộ danh sách yêu thích.
router.delete('/', wishlistController.clearWishlist);

export default router;
