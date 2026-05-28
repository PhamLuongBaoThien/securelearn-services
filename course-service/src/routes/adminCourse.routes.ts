// Admin course review routes.
import { Router } from 'express';
import courseController from '../controllers/course.controller';
import { extractUser, requireAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.get('/review', extractUser, requireAdmin, courseController.getCoursesForReview);
router.get('/:id/review', extractUser, requireAdmin, courseController.getCourseReviewDetail);
router.patch('/:id/approve', extractUser, requireAdmin, courseController.approveCourse);
router.patch('/:id/reject', extractUser, requireAdmin, courseController.rejectCourse);

export default router;
