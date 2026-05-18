// File này là controller cho Lesson.
// Điểm quan trọng:
// - lesson CRUD tách riêng khỏi course update
// - bind video asset là endpoint riêng
// - attachment (tài liệu đính kèm) dùng chung cho cả VIDEO lẫn QUIZ
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
          content: req.body.content,
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
          content: req.body.content,
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
        req.body.videoAssetId,
        req.header('Authorization')
      );

      res.status(200).json({ status: 'OK', message: 'Đã gắn video asset vào bài học.', data: lesson });
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

  // Thêm tài liệu đính kèm vào bài học (áp dụng cho cả VIDEO lẫn QUIZ)
  public async addAttachment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.addAttachment(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!,
        req.body.documentAssetId,
        req.header('Authorization')
      );

      res.status(200).json({ status: 'OK', message: 'Đã thêm tài liệu đính kèm vào bài học.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  // Xóa 1 tài liệu đính kèm khỏi bài học
  public async removeAttachment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const lesson = await lessonService.removeAttachment(
        req.params.courseId as string,
        req.params.lessonId as string,
        req.userId!,
        req.params.documentAssetId as string,
      );

      res.status(200).json({ status: 'OK', message: 'Đã gỡ tài liệu đính kèm khỏi bài học.', data: lesson });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new LessonController();
