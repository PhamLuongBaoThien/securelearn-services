// File này khai báo route cho Lesson dưới scope của một course.
// Ngoài CRUD lesson còn có route bind video/document asset.
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
// [POST] /api/courses/:courseId/lessons/:lessonId/document-asset
router.post('/lessons/:lessonId/document-asset', lessonController.bindDocumentAsset);
// [DELETE] /api/courses/:courseId/lessons/:lessonId/video-asset
router.delete('/lessons/:lessonId/video-asset', lessonController.unbindVideoAsset);
// [DELETE] /api/courses/:courseId/lessons/:lessonId/document-asset
router.delete('/lessons/:lessonId/document-asset', lessonController.unbindDocumentAsset);

export default router;
