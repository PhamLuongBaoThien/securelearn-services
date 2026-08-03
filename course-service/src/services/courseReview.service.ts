import { Types } from 'mongoose';
import { Course, CourseStatus } from '../models/course.model';
import { CourseReview, ICourseReview } from '../models/courseReview.model';
import { Enrollment, EnrollmentStatus } from '../models/enrollment.model';

type ReviewerSnapshot = {
  userId: string;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
};

class CourseReviewService {
  private mapReview(review: ICourseReview | any) {
    return {
      _id: review._id.toString(),
      courseId: review.courseId.toString(),
      userId: review.userId,
      userName: review.userName || 'Học viên SecureLearn',
      userAvatarUrl: review.userAvatarUrl || '',
      rating: review.rating,
      comment: review.comment || '',
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  private normalizeRating(rating: unknown): number {
    const value = Number(rating);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error('Vui lòng chọn số sao từ 1 đến 5.');
    }
    return value;
  }

  private normalizeComment(comment: unknown): string {
    const value = typeof comment === 'string' ? comment.trim() : '';
    if (value.length > 1000) {
      throw new Error('Nội dung đánh giá không được vượt quá 1000 ký tự.');
    }
    return value;
  }

  private async getPublishedCourse(courseId: string) {
    if (!Types.ObjectId.isValid(courseId)) throw new Error('Khóa học không hợp lệ.');
    const course = await Course.findOne({ _id: courseId, status: CourseStatus.PUBLISHED });
    if (!course) throw new Error('Khóa học không tồn tại hoặc chưa được xuất bản.');
    return course;
  }

  private async assertActiveEnrollment(userId: string, courseId: string) {
    const enrollment = await Enrollment.findOne({
      userId,
      courseId,
      status: EnrollmentStatus.ACTIVE,
    }).lean();
    if (!enrollment) throw new Error('Bạn cần ghi danh khóa học trước khi đánh giá.');
  }

  private async syncCourseRating(courseId: string) {
    const [stats] = await CourseReview.aggregate<{ _id: Types.ObjectId; average: number; count: number }>([
      { $match: { courseId: new Types.ObjectId(courseId) } },
      { $group: { _id: '$courseId', average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    await Course.findByIdAndUpdate(courseId, {
      ratingAverage: stats ? Math.round(stats.average * 10) / 10 : 0,
      ratingCount: stats?.count || 0,
    });
  }

  public async listReviews(courseId: string, page = 1, limit = 10) {
    await this.getPublishedCourse(courseId);
    const normalizedPage = Math.max(1, page || 1);
    const normalizedLimit = Math.min(50, Math.max(1, limit || 10));
    const filter = { courseId: new Types.ObjectId(courseId) };

    const [reviews, total] = await Promise.all([
      CourseReview.find(filter)
        .sort({ updatedAt: -1 })
        .skip((normalizedPage - 1) * normalizedLimit)
        .limit(normalizedLimit)
        .lean(),
      CourseReview.countDocuments(filter),
    ]);

    return {
      reviews: reviews.map((review) => this.mapReview(review)),
      total,
      page: normalizedPage,
      totalPages: Math.ceil(total / normalizedLimit),
    };
  }

  public async getMyReview(courseId: string, userId: string) {
    await this.getPublishedCourse(courseId);
    const review = await CourseReview.findOne({ courseId, userId }).lean();
    return review ? this.mapReview(review) : null;
  }

  public async upsertReview(
    courseId: string,
    reviewer: ReviewerSnapshot,
    payload: { rating: unknown; comment?: unknown; userAvatarUrl?: unknown },
  ) {
    const course = await this.getPublishedCourse(courseId);
    if (course.instructorId === reviewer.userId) {
      throw new Error('Người giảng dạy không thể đánh giá khóa học do chính mình tạo.');
    }
    await this.assertActiveEnrollment(reviewer.userId, courseId);

    const rating = this.normalizeRating(payload.rating);
    const comment = this.normalizeComment(payload.comment);

    const review = await CourseReview.findOneAndUpdate(
      { courseId, userId: reviewer.userId },
      {
        $set: {
          courseId,
          userId: reviewer.userId,
          userName: reviewer.userName || '',
          userEmail: reviewer.userEmail || '',
          userAvatarUrl: typeof payload.userAvatarUrl === 'string'
            ? payload.userAvatarUrl.trim().slice(0, 1000)
            : reviewer.userAvatarUrl || '',
          rating,
          comment,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );

    await this.syncCourseRating(courseId);
    return this.mapReview(review);
  }

  public async getInstructorRatingStats(instructorId: string) {
    const [stats] = await CourseReview.aggregate<{
      _id: null;
      averageRating: number;
      reviewCount: number;
      fiveStarCount: number;
    }>([
      {
        $lookup: {
          from: 'courses',
          localField: 'courseId',
          foreignField: '_id',
          as: 'course',
        },
      },
      { $unwind: '$course' },
      {
        $match: {
          'course.instructorId': instructorId,
          'course.status': CourseStatus.PUBLISHED,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 },
          fiveStarCount: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
        },
      },
    ]);

    const courses = await Course.find({ instructorId, status: CourseStatus.PUBLISHED })
      .select('_id enrollmentCount ratingAverage ratingCount title slug')
      .lean();

    const uniqueStudentIds = await Enrollment.distinct('userId', {
      courseId: { $in: courses.map((course) => course._id) },
      status: { $ne: EnrollmentStatus.CANCELLED },
    });
    return {
      instructorId,
      averageRating: stats ? Math.round(stats.averageRating * 10) / 10 : 0,
      reviewCount: stats?.reviewCount || 0,
      fiveStarCount: stats?.fiveStarCount || 0,
      courseCount: courses.length,
      studentCount: uniqueStudentIds.length,
      courses: courses.map((course) => ({
        _id: course._id.toString(),
        title: course.title,
        slug: course.slug,
        rating: course.ratingAverage || 0,
        reviews: course.ratingCount || 0,
        enrollmentCount: course.enrollmentCount || 0,
      })),
    };
  }
}

export default new CourseReviewService();
