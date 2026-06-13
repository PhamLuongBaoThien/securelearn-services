// ========================
// Admin Course Routes
// Mục đích:
// - gom route review/publish của Admin cho course
// - thêm route duyệt catalog thuê bao tách biệt khỏi publish review
// ========================
import { Router } from 'express';
import courseController from '../controllers/course.controller';
import { extractUser, requireAdmin } from '../middlewares/auth.middleware';
import subscriptionAccessController from '../controllers/subscriptionAccess.controller';

const router = Router();

router.get('/review', extractUser, requireAdmin, courseController.getCoursesForReview);
router.get('/:id/review', extractUser, requireAdmin, courseController.getCourseReviewDetail);
router.patch('/:id/approve', extractUser, requireAdmin, courseController.approveCourse);
router.patch('/:id/reject', extractUser, requireAdmin, courseController.rejectCourse);
// Admin duyệt/từ chối/rút course khỏi catalog thuê bao bằng route riêng để không trộn với publish review.
router.patch('/:id/subscription-review', extractUser, requireAdmin, subscriptionAccessController.review);

export default router;
