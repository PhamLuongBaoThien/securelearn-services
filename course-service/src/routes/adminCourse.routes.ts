// ========================
// Admin Course Routes
// Mục đích:
// - gom route review/publish của Admin cho course
// - thêm route duyệt catalog thuê bao tách biệt khỏi publish review
// ========================
import { Router } from 'express';
import courseController from '../controllers/course.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';
import subscriptionAccessController from '../controllers/subscriptionAccess.controller';

const router = Router();

// [GET] /api/admin/courses — Admin tra cứu, lọc và phân trang toàn bộ khóa học.
router.get('/', extractUser, requireAdmin, requirePermission('course:read'), courseController.getAdminCourses);
// [PATCH] /api/admin/courses/watch — Đánh dấu/bỏ đánh dấu nhiều khóa cần theo dõi trong màn quản trị.
router.patch('/watch', extractUser, requireAdmin, requirePermission('course:update'), courseController.updateAdminCourseWatch);
// [PATCH] /api/admin/courses/:id/category — Admin phân loại hoặc thay đổi danh mục của khóa học.
router.patch('/:id/category', extractUser, requireAdmin, requirePermission('course:update'), courseController.updateAdminCourseCategory);
// [GET] /api/admin/courses/:id/students — Admin xem danh sách học viên đã ghi danh vào khóa.
router.get('/:id/students', extractUser, requireAdmin, requirePermission('course:read'), courseController.getCourseStudents);
// [GET] /api/admin/courses/review — Lấy hàng đợi khóa học đang chờ duyệt xuất bản.
router.get('/review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getCoursesForReview);
// [PATCH] /api/admin/courses/review/multi — Duyệt hoặc từ chối nhiều khóa trong một thao tác.
router.patch('/review/multi', extractUser, requireAdmin, requirePermission('course:approve'), courseController.multiReviewCourses);
// [GET] /api/admin/courses/subscription-review — Lấy hàng đợi xin tham gia catalog thuê bao.
router.get('/subscription-review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getSubscriptionReviewCourses);
// [PATCH] /api/admin/courses/subscription-review/multi — Duyệt/từ chối nhiều yêu cầu catalog thuê bao.
router.patch('/subscription-review/multi', extractUser, requireAdmin, requirePermission('course:approve'), subscriptionAccessController.multiReview);
// [GET] /api/admin/courses/:id/subscription-review — Xem chi tiết một yêu cầu tham gia catalog thuê bao.
router.get('/:id/subscription-review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getSubscriptionReviewDetail);
// [GET] /api/admin/courses/:id/review — Xem nội dung phiên bản khóa học để duyệt xuất bản.
router.get('/:id/review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getCourseReviewDetail);
// [PATCH] /api/admin/courses/:id/approve — Phê duyệt và xuất bản phiên bản khóa học đang chờ.
router.patch('/:id/approve', extractUser, requireAdmin, requirePermission('course:approve'), courseController.approveCourse);
// [PATCH] /api/admin/courses/:id/reject — Từ chối phiên bản đang chờ và lưu lý do phản hồi.
router.patch('/:id/reject', extractUser, requireAdmin, requirePermission('course:approve'), courseController.rejectCourse);
// Admin duyệt/từ chối/rút course khỏi catalog thuê bao bằng route riêng để không trộn với publish review.
// [PATCH] /api/admin/courses/:id/subscription-review — Xử lý trạng thái catalog thuê bao của một khóa.
router.patch('/:id/subscription-review', extractUser, requireAdmin, requirePermission('course:approve'), subscriptionAccessController.review);

export default router;
