import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import progressService from '../services/progress.service';
import { LessonProgressType } from '../models/lessonProgress.model';

class ProgressController {
  public async heartbeat(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await progressService.heartbeat({
        userId: req.userId!,
        userRole: req.userRole!,
        courseId: String(req.body.courseId || ''),
        lessonId: String(req.body.lessonId || ''),
        lessonType: req.body.lessonType as LessonProgressType,
        sessionId: String(req.body.sessionId || ''),
        positionSeconds: req.body.positionSeconds,
        watchedSecondsDelta: req.body.watchedSecondsDelta,
        segmentStartSeconds: req.body.segmentStartSeconds,
        playbackRate: req.body.playbackRate,
        tabVisible: req.body.tabVisible,
        quizAttemptId: req.body.quizAttemptId,
        deviceInfo: req.header('user-agent') || '',
      });

      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async quizComplete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await progressService.quizComplete({
        userId: req.userId!,
        userRole: req.userRole!,
        courseId: String(req.body.courseId || ''),
        lessonId: String(req.body.lessonId || ''),
        attemptId: String(req.body.attemptId || ''),
        score: Number(req.body.score || 0),
        passed: Boolean(req.body.passed),
      });

      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getCourseProgress(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await progressService.getCourseProgress(
        req.userId!,
        req.userRole!,
        String(req.params.courseId)
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getMyCoursesProgress(req: AuthRequest, res: Response): Promise<void> {
    try {
      const rawCourseIds = Array.isArray(req.query.courseIds)
        ? req.query.courseIds.join(',')
        : String(req.query.courseIds || '');
      const courseIds = rawCourseIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      const data = await progressService.getMyCoursesProgress(req.userId!, courseIds);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new ProgressController();
