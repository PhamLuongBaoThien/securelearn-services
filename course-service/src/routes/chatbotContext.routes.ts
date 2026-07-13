import { Router } from 'express';
import chatbotContextController from '../controllers/chatbotContext.controller';

const router = Router();

router.get('/courses/search', chatbotContextController.searchCourses);
router.get('/courses/popular', chatbotContextController.popularCourses);

export default router;
