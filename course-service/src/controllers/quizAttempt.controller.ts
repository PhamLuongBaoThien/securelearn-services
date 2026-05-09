// File này là controller cho flow học viên làm quiz.
// Tách riêng khỏi quiz manage để tránh lẫn payload instructor và student.
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import quizAttemptService from '../services/quizAttempt.service';
import quizService from '../services/quiz.service';

class QuizAttemptController {
  public async getQuizForAttempt(req: AuthRequest, res: Response): Promise<void> {
    try {
      const quiz = await quizService.getQuizForAttempt(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!
      );

      res.status(200).json({ status: 'OK', data: quiz });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  public async startAttempt(req: AuthRequest, res: Response): Promise<void> {
    try {
      const attempt = await quizAttemptService.startAttempt(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.params.quizId as string,
        req.userId!
      );

      res.status(201).json({ status: 'OK', data: attempt });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async submitAttempt(req: AuthRequest, res: Response): Promise<void> {
    try {
      const attempt = await quizAttemptService.submitAttempt(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.params.quizId as string,
        req.params.attemptId as string,
        req.userId!,
        req.body.answers || []
      );

      res.status(200).json({ status: 'OK', message: 'Nộp bài thành công.', data: attempt });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new QuizAttemptController();
