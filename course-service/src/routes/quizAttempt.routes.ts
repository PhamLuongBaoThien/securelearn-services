// File này khai báo route cho học viên làm quiz.
// Tách khỏi quiz manage để payload student không lộ đáp án đúng.
import { Router } from 'express';
import quizAttemptController from '../controllers/quizAttempt.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router({ mergeParams: true });

// [GET] /api/courses/:courseId/lessons/:lessonId/quiz/play — Trả đề làm bài đã loại bỏ đáp án đúng cho học viên.
router.get('/:courseId/lessons/:lessonId/quiz/play', extractUser, requireStudentOrInstructor, quizAttemptController.getQuizForAttempt);

// [POST] /api/courses/:courseId/lessons/:lessonId/quiz/:quizId/attempts — Tạo một lượt làm quiz mới sau kiểm tra quyền.
router.post('/:courseId/lessons/:lessonId/quiz/:quizId/attempts', extractUser, requireStudentOrInstructor, quizAttemptController.startAttempt);

// [GET] /api/courses/:courseId/lessons/:lessonId/quiz/:quizId/attempts — Liệt kê lịch sử các lượt làm quiz của người dùng.
router.get('/:courseId/lessons/:lessonId/quiz/:quizId/attempts', extractUser, requireStudentOrInstructor, quizAttemptController.listAttempts);

// [POST] /api/courses/:courseId/lessons/:lessonId/quiz/:quizId/attempts/:attemptId/submit — Chấm bài, lưu kết quả và phát sự kiện cập nhật tiến độ.
router.post('/:courseId/lessons/:lessonId/quiz/:quizId/attempts/:attemptId/submit', extractUser, requireStudentOrInstructor, quizAttemptController.submitAttempt);

export default router;
