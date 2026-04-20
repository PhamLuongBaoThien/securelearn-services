// ========================
// Service Layer: Logic nghiệp vụ Ghi danh
// ========================
import { Enrollment, IEnrollment, EnrollmentStatus } from '../models/enrollment.model';
import { Course } from '../models/course.model';
import { publishEnrollmentCreated } from '../events/publishers';

class EnrollmentService {
  /**
   * Ghi danh học viên vào khóa học.
   */
  public async enroll(userId: string, courseId: string): Promise<IEnrollment> {
    // 1. Kiểm tra khóa học có tồn tại và đã PUBLISHED không
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.status !== 'PUBLISHED') {
      throw new Error('Khóa học chưa được xuất bản, không thể ghi danh.');
    }

    // 2. Kiểm tra đã ghi danh chưa
    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing) {
      throw new Error('Bạn đã ghi danh khóa học này rồi.');
    }

    // 3. Tạo enrollment
    const enrollment = new Enrollment({
      userId,
      courseId,
      status: EnrollmentStatus.ACTIVE,
    });
    await enrollment.save();

    // 4. Tăng enrollmentCount trên Course
    await Course.findByIdAndUpdate(courseId, { $inc: { enrollmentCount: 1 } });

    // 5. Publish event
    await publishEnrollmentCreated({
      enrollmentId: enrollment._id.toString(),
      userId,
      courseId,
    });

    return enrollment;
  }

  /**
   * Lấy danh sách khóa học đã ghi danh của user.
   */
  public async getEnrolledCourses(userId: string): Promise<any[]> {
    const enrollments = await Enrollment.find({ userId, status: EnrollmentStatus.ACTIVE })
      .populate('courseId', 'title slug thumbnail instructorName category level totalDuration totalLessons')
      .sort({ enrolledAt: -1 });

    return enrollments;
  }
}

export default new EnrollmentService();
