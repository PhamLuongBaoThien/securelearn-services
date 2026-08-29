import { Router } from 'express';
import progressController from '../controllers/progress.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router();

// Áp dụng cho toàn bộ /api/progress: yêu cầu JWT hợp lệ và vai trò STUDENT hoặc INSTRUCTOR.
router.use(extractUser, requireStudentOrInstructor);

// [POST] /api/progress/learning-sessions/acquire — Kiểm tra quyền/xung đột và cấp Learning Session + lease Redis để phát video.
router.post('/learning-sessions/acquire', progressController.acquireLearningSession);
// [DELETE] /api/progress/learning-sessions/:sessionId — Giải phóng lease và kết thúc phiên học khi rời player.
router.delete('/learning-sessions/:sessionId', progressController.releaseLearningSession);
// [POST] /api/progress/heartbeat — Gia hạn phiên học và ghi nhận đoạn video, vị trí cùng tiến độ thực xem.
router.post('/heartbeat', progressController.heartbeat);
// [POST] /api/progress/quiz-complete — Nhận kết quả quiz hợp lệ và cập nhật tiến độ bài kiểm tra/khóa học.
router.post('/quiz-complete', progressController.quizComplete);
// [GET] /api/progress/me/activity — Lấy streak và hoạt động học tập hằng ngày của người dùng hiện tại.
router.get('/me/activity', progressController.getLearnerActivity);
// [GET] /api/progress/my-courses — Tổng hợp tiến độ của người dùng trên các khóa đang học.
router.get('/my-courses', progressController.getMyCoursesProgress);
// [GET] /api/progress/instructor/courses/:courseId/analytics — Trả số liệu học tập của học viên cho giảng viên sở hữu khóa.
router.get('/instructor/courses/:courseId/analytics', progressController.getInstructorCourseAnalytics);
// [GET] /api/progress/courses/:courseId/access — Xác định bài nào được mở/bị khóa theo tiến độ tuần tự.
router.get('/courses/:courseId/access', progressController.getCourseAccess);
// [GET] /api/progress/courses/:courseId — Lấy tiến độ từng bài, vị trí xem gần nhất và phần trăm toàn khóa.
router.get('/courses/:courseId', progressController.getCourseProgress);

export default router;
