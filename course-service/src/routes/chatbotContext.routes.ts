import { Router } from 'express';
import chatbotContextController from '../controllers/chatbotContext.controller';

const router = Router();

// [GET] /internal/chatbot/courses/search — Tìm tối đa 8 khóa PUBLISHED theo từ khóa/danh mục để chatbot tư vấn.
router.get('/courses/search', chatbotContextController.searchCourses);
// [GET] /internal/chatbot/courses/popular — Lấy khóa phổ biến theo lượt đăng ký/rating làm context dự phòng.
router.get('/courses/popular', chatbotContextController.popularCourses);
// [GET] /internal/chatbot/categories — Trả các danh mục đang hoạt động cho chatbot giới thiệu chủ đề học.
router.get('/categories', chatbotContextController.getCategories);

export default router;
