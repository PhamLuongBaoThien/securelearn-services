// File này khai báo route cho học viên làm quiz.
// Tách khỏi quiz manage để payload student không lộ đáp án đúng.
import { Router } from 'express';
import quizAttemptController from '../controllers/quizAttempt.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router({ mergeParams: true });

// [GET] /api/courses/:courseId/lessons/:lessonId/quiz/play
router.get('/:courseId/lessons/:lessonId/quiz/play', extractUser, requireStudentOrInstructor, quizAttemptController.getQuizForAttempt);

// [POST] /api/courses/:courseId/lessons/:lessonId/quiz/:quizId/attempts
router.post('/:courseId/lessons/:lessonId/quiz/:quizId/attempts', extractUser, requireStudentOrInstructor, quizAttemptController.startAttempt);

// [POST] /api/courses/:courseId/lessons/:lessonId/quiz/:quizId/attempts/:attemptId/submit
router.post('/:courseId/lessons/:lessonId/quiz/:quizId/attempts/:attemptId/submit', extractUser, requireStudentOrInstructor, quizAttemptController.submitAttempt);

export default router;
