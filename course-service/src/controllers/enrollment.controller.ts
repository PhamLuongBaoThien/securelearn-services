// ========================
// File này là controller cho Enrollment.
// Đây là phần learner-side/public-side của domain course, không thuộc curriculum editor nhưng vẫn là luồng course.
// ========================
import { Response } from 'express';
import enrollmentService from '../services/enrollment.service';
import { AuthRequest } from '../middlewares/auth.middleware';

class EnrollmentController {
  /**
   * [POST] /api/courses/:id/enroll
   * Ghi danh vào khóa học (Student hoặc Instructor học khóa của người khác).
   */
  public async enroll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const enrollment = await enrollmentService.enroll(
        req.userId!,
        req.params.id as string,
        req.userRole!,
        { name: req.userName, email: req.userEmail },
      );

      res.status(201).json({
        status: 'OK',
        message: 'Ghi danh khóa học thành công!',
        data: enrollment,
      });
    } catch (error: any) {
      const status =
        error.message.includes('đã ghi danh') ? 409 :
        error.message.includes('không thể ghi danh') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/courses/enrolled
   * Danh sách khóa học đã ghi danh (Student).
   */
  public async getEnrolledCourses(req: AuthRequest, res: Response): Promise<void> {
    try {
      const enrollments = await enrollmentService.getEnrolledCourses(req.userId!);
      res.status(200).json({ status: 'OK', data: enrollments });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
  /**
   * [GET] /api/courses/instructor/students
   * Danh sách học viên đã ghi danh vào các khóa của instructor hiện tại.
   */
  public async getInstructorStudents(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await enrollmentService.getInstructorStudents(req.userId!);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new EnrollmentController();

