import { Router } from 'express';
import progressController from '../controllers/progress.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router();

router.use(extractUser, requireStudentOrInstructor);

router.post('/heartbeat', progressController.heartbeat);
router.post('/quiz-complete', progressController.quizComplete);
router.get('/me/activity', progressController.getLearnerActivity);
router.get('/my-courses', progressController.getMyCoursesProgress);
router.get('/instructor/courses/:courseId/analytics', progressController.getInstructorCourseAnalytics);
router.get('/courses/:courseId/access', progressController.getCourseAccess);
router.get('/courses/:courseId', progressController.getCourseProgress);

export default router;
