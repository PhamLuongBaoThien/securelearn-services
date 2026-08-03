import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import courseReviewService from '../services/courseReview.service';

class CourseReviewController {
  public async listReviews(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit } = req.query;
      const data = await courseReviewService.listReviews(
        String(req.params.id),
        page ? Number(page) : undefined,
        limit ? Number(limit) : undefined,
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  public async getMyReview(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await courseReviewService.getMyReview(String(req.params.id), req.userId!);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  public async upsertReview(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await courseReviewService.upsertReview(
        String(req.params.id),
        {
          userId: req.userId!,
          userName: req.userName,
          userEmail: req.userEmail,
        },
        {
          rating: req.body.rating,
          comment: req.body.comment,
          userAvatarUrl: req.body.userAvatarUrl,
        },
      );
      res.status(200).json({ status: 'OK', message: 'Đã lưu đánh giá khóa học.', data });
    } catch (error: any) {
      const message = error.message || 'Không thể lưu đánh giá.';
      const status = message.includes('ghi danh') || message.includes('Người giảng dạy') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message });
    }
  }

  public async getInstructorRatingStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await courseReviewService.getInstructorRatingStats(String(req.params.instructorId));
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message || 'Không thể tải đánh giá người giảng dạy.' });
    }
  }
}

export default new CourseReviewController();
