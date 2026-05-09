// File này là controller cho Quiz của lesson type QUIZ.
// Có 2 use case chính:
// - instructor tạo/cập nhật quiz
// - instructor lấy quiz đầy đủ để chỉnh sửa
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import quizService from '../services/quiz.service';

class QuizController {
  public async createQuiz(req: AuthRequest, res: Response): Promise<void> {
    try {
      const quiz = await quizService.createQuiz(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!,
        req.body
      );

      res.status(201).json({ status: 'OK', message: 'Tạo quiz thành công.', data: quiz });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async updateQuiz(req: AuthRequest, res: Response): Promise<void> {
    try {
      const quiz = await quizService.updateQuiz(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!,
        req.body
      );

      res.status(200).json({ status: 'OK', message: 'Cập nhật quiz thành công.', data: quiz });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async getQuizForManage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const quiz = await quizService.getQuizForManage(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!
      );

      res.status(200).json({ status: 'OK', data: quiz });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new QuizController();
