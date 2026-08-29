// File này khai báo route cho Lesson dưới scope của một course.
// Ngoài CRUD lesson còn có route bind video asset và quản lý attachments.
import { Router } from 'express';
import lessonController from '../controllers/lesson.controller';

const router = Router({ mergeParams: true });

// [POST] /api/courses/:courseId/sections/:sectionId/lessons — Tạo bài học mới trong một chương.
router.post('/sections/:sectionId/lessons', lessonController.createLesson);

// [PUT] /api/courses/:courseId/sections/:sectionId/lessons/reorder — Sắp xếp lại các bài trong chương.
router.put('/sections/:sectionId/lessons/reorder', lessonController.reorderLessons);

// [PUT] /api/courses/:courseId/lessons/:lessonId — Cập nhật tiêu đề, loại và nội dung bài học.
router.put('/lessons/:lessonId', lessonController.updateLesson);

// [DELETE] /api/courses/:courseId/lessons/:lessonId — Xóa bài học khỏi phiên bản khóa đang chỉnh sửa.
router.delete('/lessons/:lessonId', lessonController.deleteLesson);

// [POST] /api/courses/:courseId/lessons/:lessonId/video-asset — Gắn VideoAsset đã xử lý vào đúng bài VIDEO.
router.post('/lessons/:lessonId/video-asset', lessonController.bindVideoAsset);
// [DELETE] /api/courses/:courseId/lessons/:lessonId/video-asset — Tháo liên kết video khỏi bài học.
router.delete('/lessons/:lessonId/video-asset', lessonController.unbindVideoAsset);

// Attachment — tài liệu đính kèm cho cả VIDEO lẫn QUIZ
// [POST] /api/courses/:courseId/lessons/:lessonId/attachments — Gắn DocumentAsset làm tài liệu đính kèm của bài.
router.post('/lessons/:lessonId/attachments', lessonController.addAttachment);
// [DELETE] /api/courses/:courseId/lessons/:lessonId/attachments/:documentAssetId — Gỡ một tài liệu khỏi bài học.
router.delete('/lessons/:lessonId/attachments/:documentAssetId', lessonController.removeAttachment);

export default router;
