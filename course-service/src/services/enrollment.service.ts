// ========================
// Enrollment Service
// Mục đích:
// - quản lý ghi danh mua đứt và ghi danh bằng thuê bao
// - giữ enrollment ổn định khi user chuyển từ quyền thuê bao sang mua đứt
// ========================
import { Enrollment, EnrollmentSource, IEnrollment, EnrollmentStatus } from '../models/enrollment.model';
import { Course, SubscriptionCatalogStatus } from '../models/course.model';
import { publishEnrollmentCreated } from '../events/publishers';
import entitlementCacheService from './entitlementCache.service';

type LearnerSnapshot = {
  name?: string;
  email?: string;
  avatarUrl?: string;
};

class EnrollmentService {
  private async cachePurchaseEntitlement(userId: string, courseId: string, versionId?: string | null): Promise<void> {
    // Cache quyền mua đứt cho cả course shell và current version để các request học sau này qua Redis trước.
    await entitlementCacheService.setAllowed({
      userId,
      courseId,
      source: EnrollmentSource.PURCHASE,
    });
    if (versionId && versionId !== courseId) {
      await entitlementCacheService.setAllowed({
        userId,
        courseId: versionId,
        source: EnrollmentSource.PURCHASE,
      });
    }
  }

  private async cacheSubscriptionEntitlement(
    userId: string,
    courseId: string,
    versionId: string | null | undefined,
    subscriptionTermId: string,
    accessEndsAt: Date,
  ): Promise<void> {
    await entitlementCacheService.setAllowed({
      userId,
      courseId,
      source: EnrollmentSource.SUBSCRIPTION,
      termId: subscriptionTermId,
      accessEndsAt,
    });
    if (versionId && versionId !== courseId) {
      await entitlementCacheService.setAllowed({
        userId,
        courseId: versionId,
        source: EnrollmentSource.SUBSCRIPTION,
        termId: subscriptionTermId,
        accessEndsAt,
      });
    }
  }

  /**
   * Ghi danh học viên vào khóa học.
   * Cả STUDENT lẫn INSTRUCTOR đều có thể ghi danh,
   * nhưng INSTRUCTOR không được ghi danh khóa học do chính mình tạo.
   */
  public async enroll(userId: string, courseId: string, userRole: string, learner: LearnerSnapshot = {}): Promise<IEnrollment> {
    // Hàm ghi danh chuẩn cho mua đứt.
    // Nếu user trước đó học bằng subscription thì record cũ được nâng lên PURCHASE để chuyển quyền thành vĩnh viễn.
    // 1. Kiểm tra khóa học có tồn tại và đã PUBLISHED không
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.status !== 'PUBLISHED') {
      throw new Error('Khóa học chưa được xuất bản, không thể ghi danh.');
    }

    // 2. Giảng viên không được ghi danh khóa học do chính mình tạo
    if (userRole === 'INSTRUCTOR' && course.instructorId.toString() === userId) {
      throw new Error('Bạn không thể ghi danh khóa học do chính mình tạo.');
    }

    // 3. Kiểm tra đã ghi danh chưa
    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing) {
      if (existing.source === EnrollmentSource.SUBSCRIPTION) {
        // Nếu user đã học bằng thuê bao rồi mua đứt, nâng enrollment lên quyền vĩnh viễn.
        existing.source = EnrollmentSource.PURCHASE;
        existing.subscriptionTermId = '';
        existing.accessEndsAt = undefined;
        existing.status = EnrollmentStatus.ACTIVE;
        if (learner.name && !existing.learnerName) existing.learnerName = learner.name;
        if (learner.email && !existing.learnerEmail) existing.learnerEmail = learner.email;
        if (learner.avatarUrl && !existing.learnerAvatarUrl) existing.learnerAvatarUrl = learner.avatarUrl;
        await existing.save();
        await this.cachePurchaseEntitlement(userId, courseId, course.currentVersionId?.toString());
        return existing;
      }
      throw new Error('Bạn đã ghi danh khóa học này rồi.');
    }

    // 4. Tạo enrollment
    const enrollment = new Enrollment({
      userId,
      learnerName: learner.name || '',
      learnerEmail: learner.email || '',
      learnerAvatarUrl: learner.avatarUrl || '',
      courseId,
      status: EnrollmentStatus.ACTIVE,
      source: EnrollmentSource.PURCHASE,
    });
    await enrollment.save();
    await this.cachePurchaseEntitlement(userId, courseId, course.currentVersionId?.toString());

    // 5. Tăng enrollmentCount trên Course
    await Course.findByIdAndUpdate(courseId, { $inc: { enrollmentCount: 1 } });

    // 6. Publish event
    await publishEnrollmentCreated({
      enrollmentId: enrollment._id.toString(),
      userId,
      courseId,
      courseTitle: course.title,
      instructorId: course.instructorId.toString(),
      learnerName: learner.name || '',
      learnerEmail: learner.email || '',
      enrolledAt: enrollment.enrolledAt.toISOString(),
    });

    return enrollment;
  }

  public async enrollSubscription(
    userId: string,
    courseId: string,
    userRole: string,
    subscriptionTermId: string,
    accessEndsAt: Date,
    learner: LearnerSnapshot = {},
  ): Promise<IEnrollment> {
    const course = await Course.findById(courseId);
    if (!course || course.status !== 'PUBLISHED') throw new Error('Khóa học không tồn tại hoặc chưa xuất bản.');
    // Không cho enrollment mới hoặc gia hạn enrollment cũ sang term kế tiếp sau khi khóa đã bị rút.
    // Quyền của term đang gắn vẫn được entitlement() giữ nguyên đến endsAt.
    if (course.subscriptionStatus !== SubscriptionCatalogStatus.APPROVED) {
      throw new Error('Khóa học không còn khả dụng trong gói thuê bao.');
    }
    if (userRole === 'INSTRUCTOR' && course.instructorId.toString() === userId) {
      throw new Error('Bạn không thể học khóa học do chính mình tạo.');
    }
    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing?.source === EnrollmentSource.PURCHASE) return existing;
    if (existing) {
      // Gia hạn thuê bao chỉ cập nhật lại hạn truy cập, không tạo enrollment trùng.
      existing.status = EnrollmentStatus.ACTIVE;
      existing.subscriptionTermId = subscriptionTermId;
      existing.accessEndsAt = accessEndsAt;
      if (learner.name && !existing.learnerName) existing.learnerName = learner.name;
      if (learner.email && !existing.learnerEmail) existing.learnerEmail = learner.email;
      if (learner.avatarUrl && !existing.learnerAvatarUrl) existing.learnerAvatarUrl = learner.avatarUrl;
      await existing.save();
      await this.cacheSubscriptionEntitlement(
        userId,
        courseId,
        course.currentVersionId?.toString(),
        subscriptionTermId,
        accessEndsAt,
      );
      return existing;
    }
    const enrollment = await Enrollment.create({
      userId,
      learnerName: learner.name || '',
      learnerEmail: learner.email || '',
      learnerAvatarUrl: learner.avatarUrl || '',
      courseId,
      status: EnrollmentStatus.ACTIVE,
      source: EnrollmentSource.SUBSCRIPTION,
      subscriptionTermId,
      accessEndsAt,
    });
    await this.cacheSubscriptionEntitlement(
      userId,
      courseId,
      course.currentVersionId?.toString(),
      subscriptionTermId,
      accessEndsAt,
    );
    await Course.findByIdAndUpdate(courseId, { $inc: { enrollmentCount: 1 } });
    await publishEnrollmentCreated({ enrollmentId: enrollment._id.toString(), userId, courseId, courseTitle: course.title, instructorId: course.instructorId.toString(), learnerName: learner.name || '', learnerEmail: learner.email || '', enrolledAt: enrollment.enrolledAt.toISOString() });
    return enrollment;
  }

  /**
   * Lấy danh sách khóa học đã ghi danh của user.
   */
  public async getEnrolledCourses(userId: string): Promise<any[]> {
    const enrollments = await Enrollment.find({ userId, status: EnrollmentStatus.ACTIVE })
      .populate({
        path: 'courseId',
        select: 'title slug thumbnail instructorName categoryId level totalDuration totalLessons enrollmentCount',
        populate: {
          path: 'categoryId',
          select: 'name slug parentId',
        },
      })
      .sort({ enrolledAt: -1 });

    return enrollments;
  }
  /**
   * Lấy danh sách học viên đã ghi danh vào các khóa thuộc instructor hiện tại.
   */
  public async getInstructorStudents(instructorId: string): Promise<any> {
    const courses = await Course.find({ instructorId })
      .select('_id title slug thumbnail status enrollmentCount')
      .sort({ updatedAt: -1 })
      .lean();

    const courseIds = courses.map((course: any) => course._id);
    const enrollments = await Enrollment.find({ courseId: { $in: courseIds } })
      .populate({ path: 'courseId', select: 'title slug thumbnail status enrollmentCount' })
      .sort({ enrolledAt: -1 })
      .lean();

    const mappedEnrollments = enrollments.map((enrollment: any) => {
      const course = enrollment.courseId || null;
      return {
        _id: enrollment._id?.toString(),
        userId: enrollment.userId,
        learnerName: enrollment.learnerName || '',
        learnerEmail: enrollment.learnerEmail || '',
        learnerAvatarUrl: enrollment.learnerAvatarUrl || '',
        status: enrollment.status,
        source: enrollment.source,
        enrolledAt: enrollment.enrolledAt,
        accessEndsAt: enrollment.accessEndsAt || null,
        course: course ? {
          _id: course._id?.toString(),
          title: course.title,
          slug: course.slug,
          thumbnail: course.thumbnail || '',
          status: course.status,
          enrollmentCount: course.enrollmentCount || 0,
        } : null,
      };
    });

    return {
      enrollments: mappedEnrollments,
      summary: {
        total: mappedEnrollments.length,
        purchase: mappedEnrollments.filter((item: any) => item.source === EnrollmentSource.PURCHASE).length,
        subscription: mappedEnrollments.filter((item: any) => item.source === EnrollmentSource.SUBSCRIPTION).length,
        active: mappedEnrollments.filter((item: any) => item.status === EnrollmentStatus.ACTIVE).length,
      },
      courses: courses.map((course: any) => ({
        _id: course._id?.toString(),
        title: course.title,
        slug: course.slug,
        status: course.status,
        enrollmentCount: course.enrollmentCount || 0,
      })),
    };
  }

  /**
   * Lấy danh sách học viên đăng ký khóa học cho giao diện Admin.
   */
  public async getCourseStudentsForAdmin(courseId: string, page: number, limit: number): Promise<any> {
    const skip = (page - 1) * limit;

    const [enrollments, total] = await Promise.all([
      Enrollment.find({ courseId })
        .sort({ enrolledAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Enrollment.countDocuments({ courseId }),
    ]);

    const students = enrollments.map((enrollment: any) => ({
      _id: enrollment._id?.toString(),
      user: {
        _id: enrollment.userId,
        fullName: enrollment.learnerName || 'Học viên ẩn danh',
        email: enrollment.learnerEmail || '',
        avatarUrl: enrollment.learnerAvatarUrl || '',
      },
      enrolledAt: enrollment.enrolledAt,
    }));

    return {
      students,
      total,
    };
  }
}

export default new EnrollmentService();
