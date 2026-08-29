// File này khai báo route cho Quiz manage của instructor.
// Chỉ áp dụng cho lesson type QUIZ.
import { Router } from 'express';
import quizController from '../controllers/quiz.controller';

const router = Router({ mergeParams: true });

// [POST] /api/courses/:courseId/lessons/:lessonId/quiz — Giảng viên tạo đề quiz cho bài loại QUIZ.
router.post('/lessons/:lessonId/quiz', quizController.createQuiz);
// [PUT] /api/courses/:courseId/lessons/:lessonId/quiz — Cập nhật câu hỏi, đáp án và điều kiện đạt của quiz.
router.put('/lessons/:lessonId/quiz', quizController.updateQuiz);
// [GET] /api/courses/:courseId/lessons/:lessonId/quiz — Lấy đầy đủ đề/đáp án để giảng viên quản lý.
router.get('/lessons/:lessonId/quiz', quizController.getQuizForManage);

export default router;
