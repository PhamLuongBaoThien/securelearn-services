// File này khai báo route cho Section dưới scope của một course.
// Endpoint thực tế sẽ có prefix /api/courses/:courseId
import { Router } from 'express';
import sectionController from '../controllers/section.controller';

const router = Router({ mergeParams: true });

// [POST] /api/courses/:courseId/sections
router.post('/', sectionController.createSection);

// [PUT] /api/courses/:courseId/sections/reorder
router.put('/reorder', sectionController.reorderSections);

// [PUT] /api/courses/:courseId/sections/:sectionId
router.put('/:sectionId', sectionController.updateSection);

// [DELETE] /api/courses/:courseId/sections/:sectionId
router.delete('/:sectionId', sectionController.deleteSection);

export default router;
