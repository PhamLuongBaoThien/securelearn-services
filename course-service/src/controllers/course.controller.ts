// ========================
// Controller Layer: Xử lý Request/Response cho Khóa học
// ========================
import { Request, Response } from 'express';
import courseService from '../services/course.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getInstructorName } from '../config/identity.client';

class CourseController {
  /**
   * [POST] /api/courses
   * Tạo khóa học mới (Instructor).
   */
  public async createCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { title, description, categoryId, category, level, price } = req.body;

      if (!title) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp tên khóa học.' });
        return;
      }

      // Lấy tên giảng viên từ identity-service qua Internal API (1 lần duy nhất lúc tạo)
      const instructorName = await getInstructorName(req.userId!);

      const course = await courseService.createCourse({
        title,
        description,
        categoryId: categoryId || category,
        level,
        price,
        instructorId: req.userId!,
        instructorName,
      });

      res.status(201).json({
        status: 'OK',
        message: 'Tạo khóa học thành công!',
        data: course,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/courses/my-courses
   * Danh sách khóa học của giảng viên.
   */
  public async getMyCourses(req: AuthRequest, res: Response): Promise<void> {
    try {
      const courses = await courseService.getMyCourses(req.userId!);
      res.status(200).json({ status: 'OK', data: courses });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/courses/:id/manage
   * Chi tiết khóa học để quản lý (Instructor owner).
   */
  public async getCourseForManage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.getCourseForManage(req.params.id as string, req.userId!);
      res.status(200).json({ status: 'OK', data: course });
    } catch (error: any) {
      const status = error.message.includes('không có quyền') ? 403 : 404;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PUT] /api/courses/:id
   * Cập nhật khóa học (Instructor owner).
   */
  public async updateCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { title, shortDescription, description, thumbnail, whatYouWillLearn, requirements, categoryId, category, level, price, sections } = req.body;

      const course = await courseService.updateCourse(req.params.id as string, req.userId!, {
        title,
        shortDescription,
        description,
        thumbnail,
        whatYouWillLearn,
        requirements,
        categoryId: categoryId !== undefined ? categoryId : category,
        level,
        price,
        sections,
      });

      res.status(200).json({
        status: 'OK',
        message: 'Cập nhật khóa học thành công!',
        data: course,
      });
    } catch (error: any) {
      const status = error.message.includes('không có quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [DELETE] /api/courses/:id
   * Xóa khóa học (Instructor owner).
   */
  public async deleteCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      await courseService.deleteCourse(req.params.id as string, req.userId!);
      res.status(200).json({ status: 'OK', message: 'Đã xóa khóa học thành công.' });
    } catch (error: any) {
      const status = error.message.includes('không có quyền') ? 403 : 404;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PATCH] /api/courses/:id/publish
   * Publish khóa học (Instructor owner).
   */
  public async publishCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.publishCourse(req.params.id as string, req.userId!);
      res.status(200).json({
        status: 'OK',
        message: 'Khóa học đã được xuất bản!',
        data: course,
      });
    } catch (error: any) {
      const status = error.message.includes('không có quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/courses
   * Danh sách khóa học đã publish (Public — có search, filter, phân trang).
   */
  public async getPublishedCourses(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search, category, level } = req.query;

      const result = await courseService.getPublishedCourses({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        search: search as string,
        category: category as string,
        level: level as string,
      });

      res.status(200).json({ status: 'OK', data: result });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/courses/:slug
   * Chi tiết khóa học theo slug (Public — chỉ PUBLISHED).
   */
  public async getCourseBySlug(req: Request, res: Response): Promise<void> {
    try {
      const course = await courseService.getCourseBySlug(req.params.slug as string);
      res.status(200).json({ status: 'OK', data: course });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new CourseController();
