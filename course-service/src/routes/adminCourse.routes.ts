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

router.get('/', extractUser, requireAdmin, requirePermission('course:read'), courseController.getAdminCourses);
router.patch('/watch', extractUser, requireAdmin, requirePermission('course:update'), courseController.updateAdminCourseWatch);
router.get('/:id/students', extractUser, requireAdmin, requirePermission('course:read'), courseController.getCourseStudents);
router.get('/review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getCoursesForReview);
router.get('/subscription-review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getSubscriptionReviewCourses);
router.patch('/subscription-review/multi', extractUser, requireAdmin, requirePermission('course:approve'), subscriptionAccessController.multiReview);
router.get('/:id/subscription-review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getSubscriptionReviewDetail);
router.get('/:id/review', extractUser, requireAdmin, requirePermission('course:approve'), courseController.getCourseReviewDetail);
router.patch('/:id/approve', extractUser, requireAdmin, requirePermission('course:approve'), courseController.approveCourse);
router.patch('/:id/reject', extractUser, requireAdmin, requirePermission('course:approve'), courseController.rejectCourse);
// Admin duyệt/từ chối/rút course khỏi catalog thuê bao bằng route riêng để không trộn với publish review.
router.patch('/:id/subscription-review', extractUser, requireAdmin, requirePermission('course:approve'), subscriptionAccessController.review);

export default router;
