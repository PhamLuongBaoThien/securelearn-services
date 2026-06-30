import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import progressService from '../services/progress.service';
import { LessonProgressType } from '../models/lessonProgress.model';
import learningSessionAccessService, { LearningSessionAccessError } from '../services/learningSessionAccess.service';

class ProgressController {
  public async acquireLearningSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await learningSessionAccessService.acquire({
        userId: req.userId!, userRole: req.userRole!, authSessionId: req.sessionId!,
        clientInstanceId: String(req.body.clientInstanceId || ''), courseId: String(req.body.courseId || ''),
        lessonId: String(req.body.lessonId || ''), videoAssetId: String(req.body.videoAssetId || ''),
        force: req.body.force === true, expectedActiveSessionId: String(req.body.expectedActiveSessionId || ''),
        userAgent: req.get('user-agent') || '',
      });
      res.status(201).json({ status: 'OK', data });
    } catch (error: any) {
      const status = error instanceof LearningSessionAccessError ? error.statusCode : 400;
      res.status(status).json({ status: 'ERR', code: error.code, message: error.message, data: error.data });
    }
  }

  public async releaseLearningSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const released = await learningSessionAccessService.release(
        req.userId!, req.sessionId!, String(req.params.sessionId || ''), String(req.get('x-learning-session-token') || ''),
      );
      res.status(200).json({ status: 'OK', data: { released } });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
  public async heartbeat(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await progressService.heartbeat({
        userId: req.userId!,
        userRole: req.userRole!,
        courseId: String(req.body.courseId || ''),
        lessonId: String(req.body.lessonId || ''),
        lessonType: req.body.lessonType as LessonProgressType,
        sessionId: String(req.body.sessionId || ''),
        authSessionId: req.sessionId!,
        learningSessionToken: String(req.get('x-learning-session-token') || ''),
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
      const status = error instanceof LearningSessionAccessError ? error.statusCode : 400;
      res.status(status).json({ status: 'ERR', code: error.code, message: error.message, data: error.data });
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

  public async getCourseAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await progressService.getCourseAccess(
        req.userId!,
        req.userRole!,
        String(req.params.courseId)
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getLearnerActivity(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await progressService.getLearnerActivity(
        req.userId!,
        req.query.from ? String(req.query.from) : undefined,
        req.query.to ? String(req.query.to) : undefined
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getInstructorCourseAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await progressService.getInstructorCourseAnalytics(
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
      const data = await progressService.getMyCoursesProgress(req.userId!, req.userRole!, courseIds);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new ProgressController();
