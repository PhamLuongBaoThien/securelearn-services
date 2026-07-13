import type { Request, Response } from 'express';
import chatbotContextService from '../services/chatbotContext.service';

class ChatbotContextController {
  searchCourses = async (req: Request, res: Response) => {
    try {
      const data = await chatbotContextService.searchCourses(req.query.q, req.query.limit);
      res.json({ status: 'OK', data });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message || 'Không thể lấy dữ liệu khóa học.' });
    }
  };

  popularCourses = async (req: Request, res: Response) => {
    try {
      const data = await chatbotContextService.popularCourses(req.query.limit);
      res.json({ status: 'OK', data });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message || 'Không thể lấy dữ liệu khóa học.' });
    }
  };
}

export default new ChatbotContextController();
