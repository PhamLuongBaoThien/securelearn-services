// ========================
// File này là route chính của course-service cho domain course.
// Nó mount:
// - public course APIs
// - enrollment APIs
// - instructor APIs cho course, section, lesson, quiz
// Lưu ý:
// - slug route phải đặt trước các router.use('/:courseId', ...) broad middleware.
//   Nếu đặt sau, guest xem /api/courses/:slug sẽ bị extractUser chặn trước khi tới public route.
// - section/lesson/quiz được mount dưới :courseId
// ========================
import { Router } from 'express';
import courseController from '../controllers/course.controller';
import enrollmentController from '../controllers/enrollment.controller';
import lessonRoutes from './lesson.routes';
import quizRoutes from './quiz.routes';
import sectionRoutes from './section.routes';
import { extractUser, requireInstructor, requireStudentOrInstructor } from '../middlewares/auth.middleware';
import upload from '../middlewares/upload.middleware';

const router = Router();

// ========== PUBLIC (Không cần đăng nhập) ==========

// [GET] /api/courses — Danh sách khóa học đã publish (search, filter, pagination)
router.get('/', courseController.getPublishedCourses);

// ========== STUDENT & INSTRUCTOR (Có thể mua/học khóa học, nhưng INSTRUCTOR không được ghi danh khóa của chính mình) ==========

// [GET] /api/courses/enrolled — Danh sách khóa học đã ghi danh
router.get('/enrolled', extractUser, requireStudentOrInstructor, enrollmentController.getEnrolledCourses);

// [POST] /api/courses/:id/enroll — Ghi danh vào khóa học
router.post('/:id/enroll', extractUser, requireStudentOrInstructor, enrollmentController.enroll);

// ========== INSTRUCTOR (Cần đăng nhập + role INSTRUCTOR) ==========

// [GET] /api/courses/my-courses — Danh sách khóa học của tôi
router.get('/my-courses', extractUser, requireInstructor, courseController.getMyCourses);

// [POST] /api/courses — Tạo khóa học mới
router.post('/', extractUser, requireInstructor, courseController.createCourse);

// [POST] /api/courses/:id/submit-review — Gửi khóa học cho admin duyệt
router.post('/:id/submit-review', extractUser, requireInstructor, courseController.submitCourseForReview);

// [POST] /api/courses/:id/revisions — Tạo/lấy bản nháp cập nhật cho khóa đã publish
router.post('/:id/revisions', extractUser, requireInstructor, courseController.createOrGetRevision);

// [GET] /api/courses/:id/manage — Chi tiết khóa học (quản lý)
router.get('/:id/manage/published', extractUser, requireInstructor, courseController.getPublishedCourseForManage);
router.get('/:id/manage', extractUser, requireInstructor, courseController.getCourseForManage);

// [PUT] /api/courses/:id — Cập nhật khóa học, hỗ trợ cả metadata và thumbnail file
router.put('/:id', extractUser, requireInstructor, upload.single('thumbnail'), courseController.updateCourse);

// [POST] /api/courses/:id/publish/validate — Validate điều kiện gửi duyệt
router.post('/:id/publish/validate', extractUser, requireInstructor, courseController.validatePublish);

// [DELETE] /api/courses/:id — Xóa khóa học
router.delete('/:id', extractUser, requireInstructor, courseController.deleteCourse);

// ========== PUBLIC (Slug route — đặt trước broad nested routers để guest không bị middleware auth chặn) ==========

// [GET] /api/courses/:slug — Chi tiết khóa học theo slug
router.get('/:slug', courseController.getCourseBySlug);

router.use('/:courseId/sections', extractUser, requireInstructor, sectionRoutes);
router.use('/:courseId', extractUser, requireInstructor, sectionRoutes);
router.use('/:courseId', extractUser, requireInstructor, lessonRoutes);
router.use('/:courseId', extractUser, requireInstructor, quizRoutes);

export default router;
