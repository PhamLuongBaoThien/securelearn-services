// ========================
// Enrollment Service
// Mục đích:
// - quản lý ghi danh mua đứt và ghi danh bằng thuê bao
// - giữ enrollment ổn định khi user chuyển từ quyền thuê bao sang mua đứt
// ========================
import { Enrollment, EnrollmentSource, IEnrollment, EnrollmentStatus } from '../models/enrollment.model';
import { Course } from '../models/course.model';
import { publishEnrollmentCreated } from '../events/publishers';
import entitlementCacheService from './entitlementCache.service';

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
  public async enroll(userId: string, courseId: string, userRole: string): Promise<IEnrollment> {
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
      throw new Error('Giảng viên không thể ghi danh khóa học do chính mình tạo.');
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
        await existing.save();
        await this.cachePurchaseEntitlement(userId, courseId, course.currentVersionId?.toString());
        return existing;
      }
      throw new Error('Bạn đã ghi danh khóa học này rồi.');
    }

    // 4. Tạo enrollment
    const enrollment = new Enrollment({
      userId,
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
    });

    return enrollment;
  }

  public async enrollSubscription(
    userId: string,
    courseId: string,
    userRole: string,
    subscriptionTermId: string,
    accessEndsAt: Date
  ): Promise<IEnrollment> {
    const course = await Course.findById(courseId);
    if (!course || course.status !== 'PUBLISHED') throw new Error('Khóa học không tồn tại hoặc chưa xuất bản.');
    if (course.subscriptionStatus !== 'APPROVED') throw new Error('Khóa học không thuộc catalog thuê bao.');
    if (userRole === 'INSTRUCTOR' && course.instructorId === userId) {
      throw new Error('Giảng viên không thể học khóa học do chính mình tạo.');
    }
    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing?.source === EnrollmentSource.PURCHASE) return existing;
    if (existing) {
      // Gia hạn thuê bao chỉ cập nhật lại hạn truy cập, không tạo enrollment trùng.
      existing.status = EnrollmentStatus.ACTIVE;
      existing.subscriptionTermId = subscriptionTermId;
      existing.accessEndsAt = accessEndsAt;
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
    await publishEnrollmentCreated({ enrollmentId: enrollment._id.toString(), userId, courseId });
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
}

export default new EnrollmentService();
