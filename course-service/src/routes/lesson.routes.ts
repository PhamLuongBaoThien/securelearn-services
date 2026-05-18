// File này khai báo route cho Lesson dưới scope của một course.
// Ngoài CRUD lesson còn có route bind video asset và quản lý attachments.
import { Router } from 'express';
import lessonController from '../controllers/lesson.controller';

const router = Router({ mergeParams: true });

// [POST] /api/courses/:courseId/sections/:sectionId/lessons
router.post('/sections/:sectionId/lessons', lessonController.createLesson);

// [PUT] /api/courses/:courseId/sections/:sectionId/lessons/reorder
router.put('/sections/:sectionId/lessons/reorder', lessonController.reorderLessons);

// [PUT] /api/courses/:courseId/lessons/:lessonId
router.put('/lessons/:lessonId', lessonController.updateLesson);

// [DELETE] /api/courses/:courseId/lessons/:lessonId
router.delete('/lessons/:lessonId', lessonController.deleteLesson);

// [POST] /api/courses/:courseId/lessons/:lessonId/video-asset
router.post('/lessons/:lessonId/video-asset', lessonController.bindVideoAsset);
// [DELETE] /api/courses/:courseId/lessons/:lessonId/video-asset
router.delete('/lessons/:lessonId/video-asset', lessonController.unbindVideoAsset);

// Attachment — tài liệu đính kèm cho cả VIDEO lẫn QUIZ
// [POST] /api/courses/:courseId/lessons/:lessonId/attachments
router.post('/lessons/:lessonId/attachments', lessonController.addAttachment);
// [DELETE] /api/courses/:courseId/lessons/:lessonId/attachments/:documentAssetId
router.delete('/lessons/:lessonId/attachments/:documentAssetId', lessonController.removeAttachment);

export default router;
