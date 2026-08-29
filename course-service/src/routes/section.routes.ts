// File này khai báo route cho Section dưới scope của một course.
// Endpoint thực tế sẽ có prefix /api/courses/:courseId
import { Router } from 'express';
import sectionController from '../controllers/section.controller';

const router = Router({ mergeParams: true });

// [POST] /api/courses/:courseId/sections — Giảng viên tạo một chương mới trong bản khóa học đang chỉnh sửa.
router.post('/', sectionController.createSection);

// [PUT] /api/courses/:courseId/sections/reorder — Cập nhật thứ tự các chương trong khóa học.
router.put('/reorder', sectionController.reorderSections);

// [PUT] /api/courses/:courseId/sections/:sectionId — Sửa tên/nội dung một chương thuộc khóa.
router.put('/:sectionId', sectionController.updateSection);

// [DELETE] /api/courses/:courseId/sections/:sectionId — Xóa chương hợp lệ khỏi phiên bản đang chỉnh sửa.
router.delete('/:sectionId', sectionController.deleteSection);

export default router;
