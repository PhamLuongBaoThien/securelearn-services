// File này là controller cho Lesson.
// Điểm quan trọng:
// - lesson CRUD tách riêng khỏi course update
// - bind video/document asset là endpoint riêng theo loại lesson
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import lessonService from '../services/lesson.service';

class LessonController {
  public async createLesson(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.createLesson(
        req.params.courseId as string,
        req.params.sectionId as string,
        req.userId!,
        {
          title: req.body.title,
          type: req.body.type,
          summary: req.body.summary,
          order: req.body.order,
          duration: req.body.duration,
          isFreePreview: req.body.isFreePreview,
        }
      );

      res.status(201).json({ status: 'OK', message: 'Tạo bài học thành công.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async updateLesson(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.updateLesson(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!,
        {
          title: req.body.title,
          type: req.body.type,
          summary: req.body.summary,
          duration: req.body.duration,
          isFreePreview: req.body.isFreePreview,
          status: req.body.status,
        }
      );

      res.status(200).json({ status: 'OK', message: 'Cập nhật bài học thành công.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async deleteLesson(req: AuthRequest, res: Response): Promise<void> {
    try {
      await lessonService.deleteLesson(req.params.courseId as string, req.params.lessonId as string, req.userId!);
      res.status(200).json({ status: 'OK', message: 'Xóa bài học thành công.' });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 404;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  // áp dụng khi kéo thả để reorder các lesson trong 1 section hay khi xóa 1 lesson sẽ sort lại order của các lesson còn lại
  public async reorderLessons(req: AuthRequest, res: Response): Promise<void> {
    try {
      await lessonService.reorderLessons(
        req.params.courseId as string,
        req.params.sectionId as string,
        req.userId!,
        req.body.items
      );

      res.status(200).json({ status: 'OK', message: 'Cập nhật thứ tự bài học thành công.' });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async bindVideoAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.bindVideoAsset(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!,
        req.body.videoAssetId
      );

      res.status(200).json({ status: 'OK', message: 'Đã gắn video asset vào bài học.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async bindDocumentAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.bindDocumentAsset(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!,
        req.body.documentAssetId
      );

      res.status(200).json({ status: 'OK', message: 'Đã gắn tài liệu vào bài học.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async unbindVideoAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.unbindVideoAsset(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!
      );

      res.status(200).json({ status: 'OK', message: 'Đã gỡ video khỏi bài học.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async unbindDocumentAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.unbindDocumentAsset(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!
      );

      res.status(200).json({ status: 'OK', message: 'Đã gỡ tài liệu khỏi bài học.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new LessonController();
