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
// [GET] /api/courses/subscription-catalog — Lấy catalog khóa đã được duyệt cho gói thuê bao.
router.get('/subscription-catalog', subscriptionAccessController.catalog);
// [GET] /api/courses/instructors/:instructorId/rating — Tổng hợp điểm đánh giá các khóa của một giảng viên.
router.get('/instructors/:instructorId/rating', courseReviewController.getInstructorRatingStats);

// ========== STUDENT & INSTRUCTOR (Có thể mua/học khóa học, nhưng INSTRUCTOR không được ghi danh khóa của chính mình) ==========

// [GET] /api/courses/enrolled — Danh sách khóa học đã ghi danh
router.get('/enrolled', extractUser, requireStudentOrInstructor, enrollmentController.getEnrolledCourses);
// [GET] /api/courses/instructor/announcements — Giảng viên xem thông báo trên tất cả khóa mình sở hữu.
router.get('/instructor/announcements', extractUser, requireInstructor, courseAnnouncementController.instructorList);
// [GET] /api/courses/instructor/discussions — Giảng viên tổng hợp thảo luận cần quản lý trên các khóa.
router.get('/instructor/discussions', extractUser, requireInstructor, learningInteractionController.listInstructorDiscussions);
// [GET] /api/courses/:id/announcements/unread-count — Đếm thông báo khóa học học viên chưa đọc.
router.get('/:id/announcements/unread-count', extractUser, requireStudentOrInstructor, courseAnnouncementController.unread);
// [GET] /api/courses/:id/announcements — Liệt kê thông báo được phép xem trong khóa học.
router.get('/:id/announcements', extractUser, requireStudentOrInstructor, courseAnnouncementController.list);
// [PATCH] /api/courses/:id/announcements/:announcementId/read — Đánh dấu một thông báo khóa học đã đọc.
router.patch('/:id/announcements/:announcementId/read', extractUser, requireStudentOrInstructor, courseAnnouncementController.read);
// [POST] /api/courses/:id/announcements — Giảng viên tạo thông báo mới cho khóa sở hữu.
router.post('/:id/announcements', extractUser, requireInstructor, courseAnnouncementController.create);
// [PATCH] /api/courses/:id/announcements/:announcementId — Giảng viên cập nhật nội dung thông báo.
router.patch('/:id/announcements/:announcementId', extractUser, requireInstructor, courseAnnouncementController.update);
// [PATCH] /api/courses/:id/announcements/:announcementId/visibility — Ẩn/hiện thông báo với học viên.
router.patch('/:id/announcements/:announcementId/visibility', extractUser, requireInstructor, courseAnnouncementController.visibility);
// [PATCH] /api/courses/:id/announcements/:announcementId/pin — Ghim hoặc bỏ ghim thông báo trong khóa.
router.patch('/:id/announcements/:announcementId/pin', extractUser, requireInstructor, courseAnnouncementController.pin);
// [GET] /api/courses/:id/learning — Kiểm tra entitlement và trả giáo trình phiên bản đang xuất bản để học.
router.get('/:id/learning', extractUser, requireStudentOrInstructor, courseController.getCourseForLearning);
// [GET] /api/courses/:id/lessons/:lessonId/notes — Lấy ghi chú cá nhân của người học trong bài.
router.get('/:id/lessons/:lessonId/notes', extractUser, requireStudentOrInstructor, learningInteractionController.listNotes);
// [POST] /api/courses/:id/lessons/:lessonId/notes — Tạo ghi chú cá nhân tại vị trí/nội dung bài học.
router.post('/:id/lessons/:lessonId/notes', extractUser, requireStudentOrInstructor, learningInteractionController.createNote);
// [PUT] /api/courses/:id/lessons/:lessonId/notes/:noteId — Sửa ghi chú thuộc người dùng hiện tại.
router.put('/:id/lessons/:lessonId/notes/:noteId', extractUser, requireStudentOrInstructor, learningInteractionController.updateNote);
// [DELETE] /api/courses/:id/lessons/:lessonId/notes/:noteId — Xóa ghi chú cá nhân khỏi bài.
router.delete('/:id/lessons/:lessonId/notes/:noteId', extractUser, requireStudentOrInstructor, learningInteractionController.deleteNote);
// [GET] /api/courses/:id/lessons/:lessonId/discussions — Liệt kê các chủ đề thảo luận trong bài.
router.get('/:id/lessons/:lessonId/discussions', extractUser, requireStudentOrInstructor, learningInteractionController.listDiscussions);
// [POST] /api/courses/:id/lessons/:lessonId/discussions — Tạo chủ đề hoặc phản hồi thảo luận trong bài.
router.post('/:id/lessons/:lessonId/discussions', extractUser, requireStudentOrInstructor, learningInteractionController.createDiscussion);
// [GET] /api/courses/:id/lessons/:lessonId/discussions/:discussionId/replies — Lấy các phản hồi con của thảo luận.
router.get('/:id/lessons/:lessonId/discussions/:discussionId/replies', extractUser, requireStudentOrInstructor, learningInteractionController.listDiscussionReplies);
// [PATCH] /api/courses/:id/lessons/:lessonId/discussions/:discussionId/reaction — Thêm/đổi/xóa cảm xúc của người dùng.
router.patch('/:id/lessons/:lessonId/discussions/:discussionId/reaction', extractUser, requireStudentOrInstructor, learningInteractionController.setDiscussionReaction);
// [PATCH] /api/courses/:id/lessons/:lessonId/discussions/:discussionId — Sửa nội dung thảo luận do người dùng sở hữu.
router.patch('/:id/lessons/:lessonId/discussions/:discussionId', extractUser, requireStudentOrInstructor, learningInteractionController.updateDiscussion);
// [DELETE] /api/courses/:id/lessons/:lessonId/discussions/:discussionId — Xóa thảo luận theo quyền sở hữu/quản lý.
router.delete('/:id/lessons/:lessonId/discussions/:discussionId', extractUser, requireStudentOrInstructor, learningInteractionController.deleteDiscussion);
// [PATCH] /api/courses/:id/lessons/:lessonId/discussions/:discussionId/moderation — Giảng viên ẩn/hiện hoặc xử lý vi phạm.
router.patch('/:id/lessons/:lessonId/discussions/:discussionId/moderation', extractUser, requireInstructor, learningInteractionController.moderateDiscussion);
// [PATCH] /api/courses/:id/lessons/:lessonId/discussions/:discussionId/pin — Giảng viên ghim/bỏ ghim thảo luận quan trọng.
router.patch('/:id/lessons/:lessonId/discussions/:discussionId/pin', extractUser, requireInstructor, learningInteractionController.pinDiscussion);
// [GET] /api/courses/:id/discussions/:discussionId/context — Xác định bài học/ngữ cảnh để mở đúng thảo luận.
router.get('/:id/discussions/:discussionId/context', extractUser, requireStudentOrInstructor, learningInteractionController.resolveDiscussionContext);
// [GET] /api/courses/:id/discussions/manage — Giảng viên quản lý toàn bộ thảo luận của một khóa.
router.get('/:id/discussions/manage', extractUser, requireInstructor, learningInteractionController.listCourseDiscussions);
// [GET] /api/courses/:id/reviews/me — Lấy đánh giá hiện tại của người dùng cho khóa.
router.get('/:id/reviews/me', extractUser, requireStudentOrInstructor, courseReviewController.getMyReview);
// [POST] /api/courses/:id/reviews — Tạo hoặc cập nhật đánh giá của học viên đủ điều kiện.
router.post('/:id/reviews', extractUser, requireStudentOrInstructor, courseReviewController.upsertReview);

// [POST] /api/courses/:id/enroll — Ghi danh vào khóa học
router.post('/:id/enroll', extractUser, requireStudentOrInstructor, enrollmentController.enroll);
// [POST] /api/courses/:id/subscription-enroll — Ghi danh khóa qua entitlement của gói thuê bao còn hiệu lực.
router.post('/:id/subscription-enroll', extractUser, requireStudentOrInstructor, subscriptionAccessController.enroll);
// [GET] /api/courses/:id/entitlement — Kiểm tra người dùng còn quyền mua/thuê bao/học khóa hay không.
router.get('/:id/entitlement', extractUser, requireStudentOrInstructor, subscriptionAccessController.entitlement);

// ========== INSTRUCTOR (Cần đăng nhập + role INSTRUCTOR) ==========

// [GET] /api/courses/my-courses — Danh sách khóa học của tôi
router.get('/my-courses', extractUser, requireInstructor, courseController.getMyCourses);
// [GET] /api/courses/instructor/students — Giảng viên xem học viên ghi danh trong các khóa sở hữu.
router.get('/instructor/students', extractUser, requireInstructor, enrollmentController.getInstructorStudents);

// [POST] /api/courses — Tạo khóa học mới
router.post('/', extractUser, requireInstructor, courseController.createCourse);

// [POST] /api/courses/:id/submit-review — Gửi khóa học cho admin duyệt
router.post('/:id/submit-review', extractUser, requireInstructor, courseController.submitCourseForReview);
// [POST] /api/courses/:id/subscription-opt-in — Giảng viên gửi khóa xin tham gia catalog thuê bao.
router.post('/:id/subscription-opt-in', extractUser, requireInstructor, subscriptionAccessController.optIn);
// [POST] /api/courses/:id/subscription-withdraw — Giảng viên rút yêu cầu hoặc khóa khỏi catalog thuê bao.
router.post('/:id/subscription-withdraw', extractUser, requireInstructor, subscriptionAccessController.withdraw);

// [POST] /api/courses/:id/revisions — Tạo/lấy bản nháp cập nhật cho khóa đã publish
router.post('/:id/revisions', extractUser, requireInstructor, courseController.createOrGetRevision);

// [GET] /api/courses/:id/manage — Chi tiết khóa học (quản lý)
// [GET] /api/courses/:id/manage/published — Lấy bản đã xuất bản để giảng viên đối chiếu với bản nháp.
router.get('/:id/manage/published', extractUser, requireInstructor, courseController.getPublishedCourseForManage);
// [GET] /api/courses/:id/manage — Lấy phiên bản đang chỉnh sửa cùng giáo trình đầy đủ cho course editor.
router.get('/:id/manage', extractUser, requireInstructor, courseController.getCourseForManage);

// [PUT] /api/courses/:id — Cập nhật khóa học, hỗ trợ cả metadata và thumbnail file
router.put('/:id', extractUser, requireInstructor, upload.single('thumbnail'), courseController.updateCourse);

// [POST] /api/courses/:id/publish/validate — Validate điều kiện gửi duyệt
router.post('/:id/publish/validate', extractUser, requireInstructor, courseController.validatePublish);

// [DELETE] /api/courses/:id — Xóa khóa học
router.delete('/:id', extractUser, requireInstructor, courseController.deleteCourse);

// ========== PUBLIC (Slug route — đặt trước broad nested routers để guest không bị middleware auth chặn) ==========

// [GET] /api/courses/:id/reviews — Công khai danh sách đánh giá đã duyệt của khóa học.
router.get('/:id/reviews', courseReviewController.listReviews);
// [GET] /api/courses/:id/related — Gợi ý các khóa đã xuất bản có danh mục/chủ đề liên quan.
router.get('/:id/related', courseController.getRelatedCourses);
// [GET] /api/courses/:slug — Lấy trang chi tiết công khai của khóa học theo slug.
router.get('/:slug', courseController.getCourseBySlug);

// Mount CRUD chương tại /api/courses/:courseId/sections cho giảng viên sở hữu khóa.
router.use('/:courseId/sections', extractUser, requireInstructor, sectionRoutes);
// Mount tương thích các route chương dùng prefix trực tiếp /api/courses/:courseId.
router.use('/:courseId', extractUser, requireInstructor, sectionRoutes);
// Mount CRUD bài học, liên kết video và tài liệu cho giảng viên sở hữu khóa.
router.use('/:courseId', extractUser, requireInstructor, lessonRoutes);
// Mount API quản lý đề quiz có đầy đủ đáp án cho giảng viên.
router.use('/:courseId', extractUser, requireInstructor, quizRoutes);

export default router;


