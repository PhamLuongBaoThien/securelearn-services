// File này khai báo route cho Quiz manage của instructor.
// Chỉ áp dụng cho lesson type QUIZ.
import { Router } from 'express';
import quizController from '../controllers/quiz.controller';

const router = Router({ mergeParams: true });

// [POST] /api/courses/:courseId/lessons/:lessonId/quiz
// Tạo quiz
router.post('/lessons/:lessonId/quiz', quizController.createQuiz);
// [PUT] /api/courses/:courseId/lessons/:lessonId/quiz
// Cập nhật quiz
router.put('/lessons/:lessonId/quiz', quizController.updateQuiz);
// [GET] /api/courses/:courseId/lessons/:lessonId/quiz
// Lấy quiz
router.get('/lessons/:lessonId/quiz', quizController.getQuizForManage);

export default router;
