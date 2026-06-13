// ========================
// Course Controller
// Mục đích:
// - nhận request cho catalog, review, manage và learning của course-service
// - trả response thống nhất cho public flow, instructor editor và learning flow có entitlement
// ========================
import { Request, Response } from 'express';
import { CategoryResolutionStatus, CourseLevel } from '../models/course.model';
import courseService from '../services/course.service';
import { AuthRequest } from '../middlewares/auth.middleware';

type UpdateCoursePayload = {
  title?: string;
  shortDescription?: string;
  description?: string;
  thumbnail?: string;
  whatYouWillLearn?: string[];
  requirements?: string[];
  categoryId?: string;
  categoryResolutionStatus?: CategoryResolutionStatus;
  suggestedCategoryName?: string;
  suggestedCategoryNote?: string;
  level?: CourseLevel;
  price?: number;
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  const normalized = String(value).trim();
  return normalized ? [normalized] : [];
};

const parseOptionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseCourseLevel = (value: unknown): CourseLevel | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return value as CourseLevel;
};

const buildUpdateCoursePayload = (req: AuthRequest): UpdateCoursePayload => {
  const { title, shortDescription, description, thumbnail, categoryId, category, categoryResolutionStatus, suggestedCategoryName, suggestedCategoryNote, level, price } = req.body;

  return {
    title,
    shortDescription,
    description,
    thumbnail: req.file?.path ?? thumbnail,
    whatYouWillLearn: normalizeStringArray(req.body.whatYouWillLearn),
    requirements: normalizeStringArray(req.body.requirements),
    categoryId: categoryId !== undefined ? categoryId : category,
    categoryResolutionStatus,
    suggestedCategoryName,
    suggestedCategoryNote,
    level: parseCourseLevel(level),
    price: parseOptionalNumber(price),
  };
};

class CourseController {
  /**
   * [POST] /api/courses
   * Tạo khóa học mới (Instructor).
   */
  // Tạo metadata khóa học ban đầu, chưa đi sâu vào curriculum.
  public async createCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { title, description, categoryId, category, level, price } = req.body;

      if (!title) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp tên khóa học.' });
        return;
      }

      // Lấy tên giảng viên từ JWT payload (fullName được nhúng sẵn trong token)
      const instructorName = req.userName ?? '';

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
  // Editor instructor dùng endpoint này để lấy full course kèm sections/lessons.
  public async getCourseForManage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.getCourseForManage(req.params.id as string, req.userId!);
      res.status(200).json({ status: 'OK', data: course });
    } catch (error: any) {
      const status = error.message.includes('không có quyền') ? 403 : 404;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async getPublishedCourseForManage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.getPublishedCourseForManage(req.params.id as string, req.userId!);
      res.status(200).json({ status: 'OK', data: course });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 404;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PUT] /api/courses/:id
   * Cập nhật khóa học (Instructor owner).
   */
  public async updateCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const payload = buildUpdateCoursePayload(req);
      const course = await courseService.updateCourse(req.params.id as string, req.userId!, payload);

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
   * [POST] /api/courses/:id/submit-review
   * Gửi khóa học/revision cho admin duyệt.
   */
  public async submitCourseForReview(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.submitCourseForReview(req.params.id as string, req.userId!);
      res.status(200).json({
        status: 'OK',
        message: 'Khóa học đã được gửi duyệt!',
        data: course,
      });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/courses/:id/revisions
   * Tạo hoặc lấy bản nháp cập nhật cho khóa đã xuất bản.
   */
  public async createOrGetRevision(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.createOrGetRevision(req.params.id as string, req.userId!);
      res.status(200).json({
        status: 'OK',
        message: 'Đã mở bản cập nhật khóa học.',
        data: course,
      });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  // Giữ riêng endpoint validate để frontend kiểm tra trước khi bấm publish.
  public async validatePublish(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await courseService.validateCoursePublish(req.params.id as string, req.userId!);
      res.status(200).json({ status: 'OK', data: result });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/courses
   * Danh sách khóa học đã publish (Public — có search, filter, phân trang).
   */
  public async getPublishedCourses(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search, category, level, minPrice, maxPrice, minDuration, maxDuration, sort } = req.query;

      const result = await courseService.getPublishedCourses({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        search: search as string,
        category: category as string,
        level: level as string,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        minDuration: minDuration ? Number(minDuration) : undefined,
        maxDuration: maxDuration ? Number(maxDuration) : undefined,
        sort: sort as string,
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

  public async getCourseForLearning(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.getCourseForLearning(String(req.params.id), req.userId!);
      res.status(200).json({ status: 'OK', data: course });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 404).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/admin/courses/review
   * Danh sách khóa học/revision đang chờ admin duyệt.
   */
  public async getCoursesForReview(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, search, status } = req.query;
      const result = await courseService.getCoursesForReview({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        search: search as string,
        status: status as string,
      });
      res.status(200).json({ status: 'OK', message: 'Lấy danh sách khóa học chờ duyệt thành công.', data: result });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/admin/courses/:id/review
   * Chi tiết khóa học để admin xem curriculum trước khi duyệt.
   */
  public async getCourseReviewDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.getCourseReviewDetail(req.params.id as string);
      res.status(200).json({ status: 'OK', message: 'Lấy chi tiết khóa học thành công.', data: course });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PATCH] /api/admin/courses/:id/approve
   */
  public async approveCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.approveCourse(req.params.id as string, {
        adminId: req.userId!,
        adminName: req.userName || '',
        adminEmail: req.userEmail || '',
      }, { finalCategoryId: req.body.finalCategoryId });
      res.status(200).json({ status: 'OK', message: 'Khóa học đã được phê duyệt.', data: course });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PATCH] /api/admin/courses/:id/reject
   */
  public async rejectCourse(req: AuthRequest, res: Response): Promise<void> {
    try {
      const course = await courseService.rejectCourse(req.params.id as string, {
        adminId: req.userId!,
        adminName: req.userName || '',
        adminEmail: req.userEmail || '',
      }, req.body.reason);
      res.status(200).json({ status: 'OK', message: 'Đã gửi yêu cầu chỉnh sửa.', data: course });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new CourseController();
