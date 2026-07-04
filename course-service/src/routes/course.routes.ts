// ========================
// Course Routes
// Mục đích:
// - khai báo route public, learner và instructor cho domain course
// - giữ riêng các route entitlement của thuê bao cạnh flow học tập hiện có
// ========================
import { Router } from 'express';
import courseController from '../controllers/course.controller';
import enrollmentController from '../controllers/enrollment.controller';
import lessonRoutes from './lesson.routes';
import quizRoutes from './quiz.routes';
import sectionRoutes from './section.routes';
import { extractUser, requireInstructor, requireStudentOrInstructor } from '../middlewares/auth.middleware';
import upload from '../middlewares/upload.middleware';
import subscriptionAccessController from '../controllers/subscriptionAccess.controller';
import learningInteractionController from '../controllers/learningInteraction.controller';
import courseReviewController from '../controllers/courseReview.controller';
import courseAnnouncementController from '../controllers/courseAnnouncement.controller';

const router = Router();

// ========== PUBLIC (Không cần đăng nhập) ==========

// [GET] /api/courses — Danh sách khóa học đã publish (search, filter, pagination)
router.get('/', courseController.getPublishedCourses);
router.get('/subscription-catalog', subscriptionAccessController.catalog);
router.get('/instructors/:instructorId/rating', courseReviewController.getInstructorRatingStats);

// ========== STUDENT & INSTRUCTOR (Có thể mua/học khóa học, nhưng INSTRUCTOR không được ghi danh khóa của chính mình) ==========

// [GET] /api/courses/enrolled — Danh sách khóa học đã ghi danh
router.get('/enrolled', extractUser, requireStudentOrInstructor, enrollmentController.getEnrolledCourses);
router.get('/instructor/announcements', extractUser, requireInstructor, courseAnnouncementController.instructorList);
router.get('/instructor/discussions', extractUser, requireInstructor, learningInteractionController.listInstructorDiscussions);
router.get('/:id/announcements/unread-count', extractUser, requireStudentOrInstructor, courseAnnouncementController.unread);
router.get('/:id/announcements', extractUser, requireStudentOrInstructor, courseAnnouncementController.list);
router.patch('/:id/announcements/:announcementId/read', extractUser, requireStudentOrInstructor, courseAnnouncementController.read);
router.post('/:id/announcements', extractUser, requireInstructor, courseAnnouncementController.create);
router.patch('/:id/announcements/:announcementId', extractUser, requireInstructor, courseAnnouncementController.update);
router.patch('/:id/announcements/:announcementId/visibility', extractUser, requireInstructor, courseAnnouncementController.visibility);
router.patch('/:id/announcements/:announcementId/pin', extractUser, requireInstructor, courseAnnouncementController.pin);
router.get('/:id/learning', extractUser, requireStudentOrInstructor, courseController.getCourseForLearning);
router.get('/:id/lessons/:lessonId/notes', extractUser, requireStudentOrInstructor, learningInteractionController.listNotes);
router.post('/:id/lessons/:lessonId/notes', extractUser, requireStudentOrInstructor, learningInteractionController.createNote);
router.put('/:id/lessons/:lessonId/notes/:noteId', extractUser, requireStudentOrInstructor, learningInteractionController.updateNote);
router.delete('/:id/lessons/:lessonId/notes/:noteId', extractUser, requireStudentOrInstructor, learningInteractionController.deleteNote);
router.get('/:id/lessons/:lessonId/discussions', extractUser, requireStudentOrInstructor, learningInteractionController.listDiscussions);
router.post('/:id/lessons/:lessonId/discussions', extractUser, requireStudentOrInstructor, learningInteractionController.createDiscussion);
router.get('/:id/lessons/:lessonId/discussions/:discussionId/replies', extractUser, requireStudentOrInstructor, learningInteractionController.listDiscussionReplies);
router.patch('/:id/lessons/:lessonId/discussions/:discussionId', extractUser, requireStudentOrInstructor, learningInteractionController.updateDiscussion);
router.delete('/:id/lessons/:lessonId/discussions/:discussionId', extractUser, requireStudentOrInstructor, learningInteractionController.deleteDiscussion);
router.patch('/:id/lessons/:lessonId/discussions/:discussionId/moderation', extractUser, requireInstructor, learningInteractionController.moderateDiscussion);
router.patch('/:id/lessons/:lessonId/discussions/:discussionId/pin', extractUser, requireInstructor, learningInteractionController.pinDiscussion);
router.get('/:id/discussions/manage', extractUser, requireInstructor, learningInteractionController.listCourseDiscussions);
router.get('/:id/reviews/me', extractUser, requireStudentOrInstructor, courseReviewController.getMyReview);
router.post('/:id/reviews', extractUser, requireStudentOrInstructor, courseReviewController.upsertReview);

// [POST] /api/courses/:id/enroll — Ghi danh vào khóa học
router.post('/:id/enroll', extractUser, requireStudentOrInstructor, enrollmentController.enroll);
router.post('/:id/subscription-enroll', extractUser, requireStudentOrInstructor, subscriptionAccessController.enroll);
router.get('/:id/entitlement', extractUser, requireStudentOrInstructor, subscriptionAccessController.entitlement);

// ========== INSTRUCTOR (Cần đăng nhập + role INSTRUCTOR) ==========

// [GET] /api/courses/my-courses — Danh sách khóa học của tôi
router.get('/my-courses', extractUser, requireInstructor, courseController.getMyCourses);
router.get('/instructor/students', extractUser, requireInstructor, enrollmentController.getInstructorStudents);

// [POST] /api/courses — Tạo khóa học mới
router.post('/', extractUser, requireInstructor, courseController.createCourse);

// [POST] /api/courses/:id/submit-review — Gửi khóa học cho admin duyệt
router.post('/:id/submit-review', extractUser, requireInstructor, courseController.submitCourseForReview);
router.post('/:id/subscription-opt-in', extractUser, requireInstructor, subscriptionAccessController.optIn);
router.post('/:id/subscription-withdraw', extractUser, requireInstructor, subscriptionAccessController.withdraw);

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
router.get('/:id/reviews', courseReviewController.listReviews);
router.get('/:slug', courseController.getCourseBySlug);

router.use('/:courseId/sections', extractUser, requireInstructor, sectionRoutes);
router.use('/:courseId', extractUser, requireInstructor, sectionRoutes);
router.use('/:courseId', extractUser, requireInstructor, lessonRoutes);
router.use('/:courseId', extractUser, requireInstructor, quizRoutes);

export default router;


