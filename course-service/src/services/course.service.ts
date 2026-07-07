// ========================
// Course Service
// Mục đích:
// - xử lý nghiệp vụ catalog, review, publish và curriculum của khóa học
// - phân tách public course detail với learning detail có entitlement để hỗ trợ flow thuê bao an toàn
// ========================
import { identityGrpcClient } from '../grpc/identity.client';
import { Types } from "mongoose";
import {
  CategoryResolutionStatus,
  Course,
  CourseProgressionMode,
  ICourse,
  CourseStatus,
  SubscriptionCatalogStatus,
} from "../models/course.model";
import { CourseVersion, ICourseVersion } from "../models/courseVersion.model";
import { Lesson, LessonStatus, LessonType } from "../models/lesson.model";
import { Quiz } from "../models/quiz.model";
import { Section } from "../models/section.model";
import {
  publishCourseCreated,
  publishCoursePublished,
  publishCourseRejected,
  publishCourseSubmittedForReview,
  publishCourseVersionPublished,
} from "../events/publishers";
import categoryService from "./category.service";
import mediaReferenceService from "./mediaReference.service";
import subscriptionAccessService from "./subscriptionAccess.service";

interface CourseLessonResponse {
  _id: string;
  title: string;
  type: string;
  status: string;
  content: string;
  duration: number;
  order: number;
  isFreePreview: boolean;
  videoAssetId: string | null;
  attachments: string[];
  quizId: string | null;
  contentMeta: { questionCount?: number } | null;
}

interface CourseResponse {
  _id: string;
  courseId: string;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  thumbnail: string;
  whatYouWillLearn: string[];
  requirements: string[];
  instructorId: string;
  instructorName: string;
  instructorProfile: {
    avatarUrl: string;
    bio: string;
  };
  categoryId: string | null;
  category: {
    _id: string;
    name: string;
    slug: string;
    parentId: string | null;
  } | null;
  categoryResolutionStatus: CategoryResolutionStatus;
  suggestedCategoryName: string;
  suggestedCategoryNote: string;
  level: string;
  progressionMode: CourseProgressionMode;
  status: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string;
  reviewedByAdmin?: { _id: string; fullName: string; email: string };
  rejectionReason: string;
  activeRevision?: {
    _id: string;
    status: string;
    rejectionReason: string;
    submittedAt: Date | null;
    updatedAt: Date;
  } | null;
  price: number;
  sections: Array<{
    _id: string;
    title: string;
    order: number;
    lessons: CourseLessonResponse[];
  }>;
  totalDuration: number;
  totalLessons: number;
  totalSections: number;
  totalQuizzes: number;
  totalDocuments: number;
  enrollmentCount: number;
  rating: number;
  reviews: number;
  subscriptionStatus: SubscriptionCatalogStatus;
  subscriptionReviewReason: string;
  subscriptionReviewedAt: Date | null;
  subscriptionReviewedByAdmin?: {
    _id: string;
    fullName: string;
    email: string;
  };
  accessSource?: "PURCHASE" | "SUBSCRIPTION";
  accessEndsAt?: Date | null;
  isRevision: boolean; // true nếu là bản cập nhật (versionNumber > 1), false nếu là bản náp lần đầu chưa xuất bản
  createdAt: Date;
  updatedAt: Date;
}

type VersionLike = {
  _id: Types.ObjectId;
  courseId: Types.ObjectId;
  versionNumber: number;
  title: string;
  slug: string;
  shortDescription?: string;
  description: string;
  thumbnail: string;
  whatYouWillLearn?: string[];
  requirements?: string[];
  instructorId: string;
  instructorName: string;
  categoryResolutionStatus?: CategoryResolutionStatus;
  suggestedCategoryName?: string;
  suggestedCategoryNote?: string;
  categoryId?:
    | Types.ObjectId
    | {
        _id: Types.ObjectId;
        name: string;
        slug: string;
        parentId?: Types.ObjectId | null;
      }
    | null;
  level: string;
  progressionMode?: CourseProgressionMode;
  status: string;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedByEmail?: string;
  rejectionReason?: string;
  price: number;
  totalDuration: number;
  totalLessons: number;
  totalSections?: number;
  createdAt: Date;
  updatedAt: Date;
};

type CourseShellLike = {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  thumbnail: string;
  instructorId: string;
  instructorName: string;
  instructorAvatarUrl?: string;
  instructorBio?: string;
  status: string;
  currentVersionId?: Types.ObjectId | null;
  draftVersionId?: Types.ObjectId | null;
  enrollmentCount: number;
  ratingAverage?: number;
  ratingCount?: number;
  subscriptionStatus?: SubscriptionCatalogStatus;
  subscriptionReviewReason?: string;
  subscriptionReviewedAt?: Date | null;
  subscriptionReviewedBy?: string;
  subscriptionReviewedByName?: string;
  subscriptionReviewedByEmail?: string;
  progressionMode?: CourseProgressionMode;
  createdAt: Date;
  updatedAt: Date;
};

interface CourseReviewResponse {
  _id: string;
  title: string;
  slug: string;
  description: string;
  thumbnailUrl: string;
  instructor: { _id: string; fullName: string; email: string };
  category: string;
  categoryId: string | null;
  categorySlug: string;
  categoryResolutionStatus: CategoryResolutionStatus;
  suggestedCategoryName: string;
  suggestedCategoryNote: string;
  level: string;
  price: number;
  status: string;
  totalLessons: number;
  totalChapters: number;
  totalDuration: number;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string;
  reviewedByAdmin?: { _id: string; fullName: string; email: string };
  rejectionReason: string;
  createdAt: Date;
  isRevision: boolean;
  courseId: string;
}

interface AdminCourseListResponse {
  _id: string;
  title: string;
  slug: string;
  thumbnail: string;
  instructorId: string;
  instructorName: string;
  category: {
    _id: string;
    name: string;
    slug: string;
    parentId: string | null;
  } | null;
  level: string;
  status: string;
  subscriptionStatus: SubscriptionCatalogStatus;
  price: number;
  totalLessons: number;
  totalSections: number;
  totalDuration: number;
  enrollmentCount: number;
  ratingAverage: number;
  ratingCount: number;
  currentVersionId: string | null;
  draftVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
type ReviewerSnapshot = {
  adminId: string;
  adminName: string;
  adminEmail: string;
};

class CourseService {
  // Kiểm tra đủ điều kiện trước khi instructor gửi CourseVersion cho admin duyệt.
  // Hàm trả thêm message đã format sẵn để frontend đưa thẳng vào toast.
  public async validateCoursePublish(versionId: string, instructorId: string) {
    const version = await CourseVersion.findById(versionId).lean();
    if (!version) throw new Error("Bản nội dung khóa học không tồn tại.");
    if (version.instructorId !== instructorId)
      throw new Error("Bạn không có quyền truy cập khóa học này.");

    const errors: Array<{
      field: string;
      message: string;
      sectionId?: string;
      lessonId?: string;
    }> = [];
    const sectionErrorGroups = new Map<
      string,
      { title: string; items: string[] }
    >();

    const addSectionError = (
      sectionId: string,
      sectionTitle: string,
      item: string,
    ) => {
      const group = sectionErrorGroups.get(sectionId);
      if (group) group.items.push(item);
      else
        sectionErrorGroups.set(sectionId, {
          title: sectionTitle,
          items: [item],
        });
    };

    const needsAdminClassification =
      version.categoryResolutionStatus ===
      CategoryResolutionStatus.NEEDS_ADMIN_CLASSIFICATION;

    if (!version.title?.trim())
      errors.push({ field: "title", message: "Khóa học chưa có tiêu đề." });
    if (!version.thumbnail?.trim())
      errors.push({
        field: "thumbnail",
        message: "Khóa học chưa có ảnh đại diện.",
      });
    if (!version.categoryId && !needsAdminClassification)
      errors.push({
        field: "categoryId",
        message: "Khóa học chưa có danh mục.",
      });
    if (needsAdminClassification && !version.suggestedCategoryName?.trim()) {
      errors.push({
        field: "suggestedCategoryName",
        message: "Vui lòng nhập chủ đề khóa học để người kiểm duyệt phân loại.",
      });
    }

    const [sections, lessons] = await Promise.all([
      Section.find({ courseId: version._id }).sort({ order: 1 }).lean(),
      Lesson.find({ courseId: version._id }).sort({ order: 1 }).lean(),
    ]);

    if (sections.length === 0)
      errors.push({
        field: "sections",
        message: "Khóa học phải có ít nhất 1 chương.",
      });

    const lessonIds = lessons.map((lesson) => lesson._id);
    const quizzes = lessonIds.length
      ? await Quiz.find({ courseId: version._id, lessonId: { $in: lessonIds } })
          .select("lessonId questions")
          .lean()
      : [];
    const quizByLessonId = new Map(
      quizzes.map((quiz) => [quiz.lessonId.toString(), quiz]),
    );

    for (const section of sections) {
      const sectionLessons = lessons.filter(
        (lesson) => lesson.sectionId.toString() === section._id.toString(),
      );
      if (sectionLessons.length === 0) {
        errors.push({
          field: "section.lessons",
          message: `Chương "${section.title}" chưa có bài học nào.`,
          sectionId: section._id.toString(),
        });
        addSectionError(
          section._id.toString(),
          section.title,
          "Chưa có bài học nào.",
        );
      }

      for (const lesson of sectionLessons) {
        const sectionId = section._id.toString();
        const lessonId = lesson._id.toString();
        const lessonLabel = `Chương "${section.title}" / Bài "${lesson.title}"`;

        if (lesson.type === LessonType.VIDEO && !lesson.videoAssetId) {
          errors.push({
            field: "lesson.videoAssetId",
            message: `${lessonLabel}: chưa có video.`,
            sectionId,
            lessonId,
          });
          addSectionError(
            sectionId,
            section.title,
            `${lesson.title}: chưa có video.`,
          );
          continue;
        }

        if (lesson.type === LessonType.QUIZ) {
          const quiz = quizByLessonId.get(lesson._id.toString());
          if (!quiz) {
            errors.push({
              field: "quiz.lessonId",
              message: `${lessonLabel}: chưa tạo quiz.`,
              sectionId,
              lessonId,
            });
            addSectionError(
              sectionId,
              section.title,
              `${lesson.title}: chưa tạo quiz.`,
            );
            continue;
          }
          if (quiz.questions.length === 0) {
            errors.push({
              field: "quiz.questions",
              message: `${lessonLabel}: quiz chưa có câu hỏi.`,
              sectionId,
              lessonId,
            });
            addSectionError(
              sectionId,
              section.title,
              `${lesson.title}: quiz chưa có câu hỏi.`,
            );
            continue;
          }
        }

        if (lesson.status !== LessonStatus.READY) {
          errors.push({
            field: "lesson.status",
            message: `${lessonLabel}: nội dung chưa sẵn sàng.`,
            sectionId,
            lessonId,
          });
          addSectionError(
            sectionId,
            section.title,
            `${lesson.title}: nội dung chưa sẵn sàng.`,
          );
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      message: this.formatPublishValidationMessage(errors, sectionErrorGroups),
    };
  }

  public async createCourse(data: {
    title: string;
    description?: string;
    categoryId?: string;
    suggestedCategoryName?: string;
    suggestedCategoryNote?: string;
    level?: string;
    progressionMode?: CourseProgressionMode;
    price?: number;
    instructorId: string;
    instructorName: string;
  }): Promise<CourseResponse> {
    const resolvedCategoryId = data.categoryId
      ? ((await categoryService.resolveActiveCategoryById(data.categoryId))
          ._id as Types.ObjectId)
      : null;

    // Tạo Course shell trước để có Course._id ổn định cho catalog/enrollment sau này.
    const shell = new Course({
      ...data,
      categoryId: resolvedCategoryId,
      suggestedCategoryName: data.suggestedCategoryName || "",
      suggestedCategoryNote: data.suggestedCategoryNote || "",
      status: CourseStatus.DRAFT,
    });
    await shell.save();

    // Khóa mới luôn có version 1 dạng DRAFT; editor làm việc với id của version này.
    const version = await CourseVersion.create({
      courseId: shell._id,
      versionNumber: 1,
      title: shell.title,
      slug: shell.slug,
      shortDescription: shell.shortDescription,
      description: data.description || "",
      thumbnail: shell.thumbnail,
      whatYouWillLearn: shell.whatYouWillLearn,
      requirements: shell.requirements,
      instructorId: shell.instructorId,
      instructorName: shell.instructorName,
      categoryId: shell.categoryId,
      categoryResolutionStatus: shell.categoryResolutionStatus,
      suggestedCategoryName: shell.suggestedCategoryName,
      suggestedCategoryNote: shell.suggestedCategoryNote,
      level: shell.level,
      progressionMode: data.progressionMode || CourseProgressionMode.FREE,
      status: CourseStatus.DRAFT,
      price: shell.price,
    });

    shell.draftVersionId = version._id as Types.ObjectId;
    await shell.save();

    await publishCourseCreated({
      courseId: shell._id.toString(),
      title: shell.title,
      instructorId: shell.instructorId,
    });
    return this.buildVersionResponse(version._id.toString(), shell);
  }

  public async getMyCourses(instructorId: string): Promise<CourseResponse[]> {
    const shells = await Course.find({ instructorId })
      .sort({ createdAt: -1 })
      .lean();

    const versionIds = shells.flatMap(
      (shell) =>
        [shell.currentVersionId, shell.draftVersionId].filter(
          Boolean,
        ) as Types.ObjectId[],
    );
    const versions = versionIds.length
      ? await CourseVersion.find({ _id: { $in: versionIds } })
          .populate("categoryId", "name slug parentId")
          .lean()
      : [];
    const versionById = new Map(
      versions.map((version) => [
        version._id.toString(),
        version as unknown as VersionLike,
      ]),
    );

    return shells.map((shell) => {
      const current = shell.currentVersionId
        ? versionById.get(shell.currentVersionId.toString())
        : undefined;
      const draft = shell.draftVersionId
        ? versionById.get(shell.draftVersionId.toString())
        : undefined;
      const primary =
        shell.status === CourseStatus.PUBLISHED && current
          ? current
          : draft || current;
      const response = this.mapVersionResponse(
        primary as VersionLike,
        shell as unknown as CourseShellLike,
        [],
      );
      response._id =
        shell.status === CourseStatus.PUBLISHED
          ? shell._id.toString()
          : primary!._id.toString();
      response.status =
        shell.status === CourseStatus.PUBLISHED
          ? shell.status
          : primary!.status;
      response.activeRevision =
        shell.status === CourseStatus.PUBLISHED && draft
          ? this.mapActiveRevision(draft)
          : null;
      return response;
    });
  }

  public async getCourseForManage(
    versionId: string,
    instructorId: string,
  ): Promise<CourseResponse> {
    const { version, shell } = await this.getOwnedVersionOrThrow(
      versionId,
      instructorId,
      true,
    );
    return this.buildVersionResponse(version._id.toString(), shell);
  }

  public async getPublishedCourseForManage(
    versionId: string,
    instructorId: string,
  ): Promise<CourseResponse> {
    const { shell } = await this.getOwnedVersionOrThrow(
      versionId,
      instructorId,
    );
    if (!shell.currentVersionId)
      throw new Error("Khóa học chưa có bản đã xuất bản.");
    return this.buildVersionResponse(shell.currentVersionId.toString(), shell);
  }

  public async updateCourse(
    versionId: string,
    instructorId: string,
    data: Partial<
      Pick<
        ICourse,
        | "title"
        | "shortDescription"
        | "description"
        | "thumbnail"
        | "whatYouWillLearn"
        | "requirements"
        | "categoryResolutionStatus"
        | "suggestedCategoryName"
        | "suggestedCategoryNote"
      | "level"
        | "progressionMode"
        | "price"
      >
    > & { categoryId?: string },
  ): Promise<CourseResponse> {
    const { version, shell } = await this.getOwnedVersionOrThrow(
      versionId,
      instructorId,
    );
    this.assertCourseEditable(version.status);

    if (data.title !== undefined) version.title = data.title;
    if (data.shortDescription !== undefined)
      version.shortDescription = data.shortDescription;
    if (data.description !== undefined) version.description = data.description;
    if (data.thumbnail !== undefined) version.thumbnail = data.thumbnail;
    if (data.whatYouWillLearn !== undefined)
      version.whatYouWillLearn = data.whatYouWillLearn;
    if (data.requirements !== undefined)
      version.requirements = data.requirements;
    const needsAdminClassification =
      data.categoryResolutionStatus ===
      CategoryResolutionStatus.NEEDS_ADMIN_CLASSIFICATION;
    if (needsAdminClassification) {
      version.categoryId = null;
      version.categoryResolutionStatus =
        CategoryResolutionStatus.NEEDS_ADMIN_CLASSIFICATION;
      version.suggestedCategoryName = String(
        data.suggestedCategoryName || "",
      ).trim();
      version.suggestedCategoryNote = String(
        data.suggestedCategoryNote || "",
      ).trim();
    } else if (data.categoryId !== undefined) {
      const category = data.categoryId
        ? await categoryService.resolveActiveCategoryById(data.categoryId)
        : null;
      version.categoryId = category ? (category._id as Types.ObjectId) : null;
      version.categoryResolutionStatus = CategoryResolutionStatus.NONE;
      version.suggestedCategoryName = "";
      version.suggestedCategoryNote = "";
    }
    if (data.level !== undefined) version.level = data.level as any;
    if (data.price !== undefined) version.price = data.price;
    if (data.progressionMode !== undefined) version.progressionMode = data.progressionMode;

    await version.save();
    await this.syncShellDraftCache(shell._id.toString(), version);
    return this.buildVersionResponse(version._id.toString(), shell);
  }

  public async deleteCourse(id: string, instructorId: string): Promise<void> {
    const shell = await Course.findOne({ _id: id, instructorId });
    const version = shell
      ? null
      : await CourseVersion.findOne({ _id: id, instructorId });
    if (!shell && !version) throw new Error("Khóa học không tồn tại.");

    const targetShell = shell || (await Course.findById(version!.courseId));
    if (!targetShell) throw new Error("Khóa học không tồn tại.");
    if (targetShell.status === CourseStatus.PUBLISHED && shell)
      throw new Error("Khóa học đã xuất bản không thể xóa trực tiếp.");
    if (version && version.status === CourseStatus.PUBLISHED)
      throw new Error("Bản nội dung đã xuất bản không thể xóa trực tiếp.");

    const shouldDeleteShell = Boolean(
      shell || (version && !targetShell.currentVersionId),
    );
    const versionIds = shouldDeleteShell
      ? await CourseVersion.find({ courseId: targetShell._id })
          .select("_id")
          .lean()
      : [{ _id: version!._id }];
    const ids = versionIds.map((item) => item._id);
    // Cleanup media theo batch trước khi xóa lesson để tránh bỏ sót asset dùng chung giữa nhiều version bị xóa cùng lúc.
    const lessons = await Lesson.find({ courseId: { $in: ids } })
      .select("_id courseId videoAssetId attachments")
      .lean();
    await mediaReferenceService.cleanupMediaForRemovedLessons(lessons);

    const lessonIds = lessons.map((lesson) => lesson._id);
    await Promise.all([
      lessonIds.length
        ? Quiz.deleteMany({ lessonId: { $in: lessonIds } })
        : Promise.resolve(),
      Section.deleteMany({ courseId: { $in: ids } }),
      Lesson.deleteMany({ courseId: { $in: ids } }),
      CourseVersion.deleteMany({ _id: { $in: ids } }),
      shouldDeleteShell
        ? Course.findByIdAndDelete(targetShell._id)
        : Course.findByIdAndUpdate(targetShell._id, {
            $set: { draftVersionId: null },
          }),
    ]);
  }

  public async submitCourseForReview(
    versionId: string,
    instructorId: string,
  ): Promise<CourseResponse> {
    const { version, shell } = await this.getOwnedVersionOrThrow(
      versionId,
      instructorId,
    );
    if (
      ![CourseStatus.DRAFT, CourseStatus.REJECTED].includes(
        version.status as CourseStatus,
      )
    ) {
      throw new Error(
        "Chỉ bản nháp hoặc bản cần chỉnh sửa mới có thể gửi duyệt.",
      );
    }
    let profileCheck;
    try { profileCheck = await identityGrpcClient.checkInstructorProfile(instructorId); }
    catch { throw new Error('Không thể xác minh hồ sơ giảng viên lúc này. Vui lòng thử lại sau.'); }
    if (!profileCheck.complete) {
      const labels: Record<string, string> = { role: 'vai trò giảng viên', fullName: 'họ tên', email: 'email đã xác minh', phone: 'số điện thoại', avatar: 'ảnh đại diện', headline: 'chức danh', bio: 'tiểu sử' };
      const missing = profileCheck.missingFields.map((field: string) => labels[field] || field).join(', ');
      const error = new Error(`Hồ sơ giảng viên chưa đầy đủ: ${missing}.`);
      (error as any).code = 'INSTRUCTOR_PROFILE_INCOMPLETE';
      (error as any).missingFields = profileCheck.missingFields;
      throw error;
    }
    const validation = await this.validateCoursePublish(
      versionId,
      instructorId,
    );
    if (!validation.ok)
      throw new Error(validation.message || validation.errors[0].message);
    if (version.categoryId) {
      await categoryService.resolveActiveCategoryById(
        version.categoryId.toString(),
      );
    } else if (
      version.categoryResolutionStatus !==
      CategoryResolutionStatus.NEEDS_ADMIN_CLASSIFICATION
    ) {
      throw new Error("Khóa học chưa có danh mục hợp lệ.");
    }

    // Instructor chỉ chuyển version sang PENDING; Course chỉ public sau khi admin approve.
    version.status = CourseStatus.PENDING;
    version.submittedAt = new Date();
    version.reviewedAt = null;
    version.reviewedBy = "";
    version.reviewedByName = "";
    version.reviewedByEmail = "";
    version.rejectionReason = "";
    await version.save();

    try {
      await publishCourseSubmittedForReview({
        courseId: shell._id.toString(),
        versionId: version._id.toString(),
        title: version.title,
        instructorId,
        instructorName: version.instructorName || '',
        submittedAt: version.submittedAt.toISOString(),
      });
    } catch (err) {
      console.error('Failed to publish COURSE_SUBMITTED_FOR_REVIEW event', err);
    }

    if (shell.status !== CourseStatus.PUBLISHED) {
      shell.status = CourseStatus.PENDING;
      await this.syncShellDraftCache(shell._id.toString(), version);
    }

    return this.buildVersionResponse(version._id.toString(), shell);
  }

  // Với khóa đã PUBLISHED, giảng viên không sửa currentVersion trực tiếp.
  // Hệ thống tạo/lấy draftVersion mới và copy curriculum hiện tại sang để chỉnh sửa an toàn.
  public async createOrGetRevision(
    courseId: string,
    instructorId: string,
  ): Promise<CourseResponse> {
    const shell = await Course.findById(courseId);
    if (!shell) throw new Error("Khóa học không tồn tại.");
    if (shell.instructorId !== instructorId)
      throw new Error("Bạn không có quyền chỉnh sửa khóa học này.");
    if (shell.status !== CourseStatus.PUBLISHED)
      throw new Error("Chỉ khóa học đã xuất bản mới cần tạo bản cập nhật.");

    if (shell.draftVersionId) {
      const existing = await CourseVersion.findOne({
        _id: shell.draftVersionId,
        status: {
          $in: [
            CourseStatus.DRAFT,
            CourseStatus.PENDING,
            CourseStatus.REJECTED,
          ],
        },
      });
      if (existing)
        return this.buildVersionResponse(existing._id.toString(), shell);
    }

    const current = await CourseVersion.findById(shell.currentVersionId);
    if (!current)
      throw new Error("Khóa học chưa có phiên bản public để tạo bản cập nhật.");
    const versionNumber =
      (await CourseVersion.countDocuments({ courseId: shell._id })) + 1;
    const draft = await CourseVersion.create({
      courseId: shell._id,
      versionNumber,
      title: current.title,
      slug: current.slug,
      shortDescription: current.shortDescription,
      description: current.description,
      thumbnail: current.thumbnail,
      whatYouWillLearn: current.whatYouWillLearn,
      requirements: current.requirements,
      instructorId: current.instructorId,
      instructorName: current.instructorName,
      categoryId: current.categoryId,
      categoryResolutionStatus: current.categoryResolutionStatus,
      suggestedCategoryName: current.suggestedCategoryName,
      suggestedCategoryNote: current.suggestedCategoryNote,
      level: current.level,
      progressionMode: current.progressionMode || shell.progressionMode || CourseProgressionMode.FREE,
      status: CourseStatus.DRAFT,
      price: current.price,
    });

    await this.copyCurriculum(
      current._id as Types.ObjectId,
      draft._id as Types.ObjectId,
    );
    await this.syncCourseStats(draft._id as Types.ObjectId);
    shell.draftVersionId = draft._id as Types.ObjectId;
    await shell.save();

    return this.buildVersionResponse(draft._id.toString(), shell);
  }

  public async getCoursesForReview(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    sort?: string;
  }): Promise<{
    courses: CourseReviewResponse[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = {
      status: query.status || CourseStatus.PENDING,
    };
    if (query.search) {
      filter.$or = [
        { title: { $regex: query.search, $options: "i" } },
        { instructorName: { $regex: query.search, $options: "i" } },
      ];
    }

    const reviewSortOptions: Record<string, Record<string, 1 | -1>> = {
      submitted_desc: { submittedAt: -1, updatedAt: -1 },
      submitted_asc: { submittedAt: 1, updatedAt: 1 },
      title_asc: { title: 1, submittedAt: -1 },
      title_desc: { title: -1, submittedAt: -1 },
    };
    const reviewSort = reviewSortOptions[query.sort || 'submitted_desc'] || reviewSortOptions.submitted_desc;

    // Admin review làm việc trực tiếp trên CourseVersion PENDING, gồm cả khóa mới và bản cập nhật.
    const [versions, total] = await Promise.all([
      CourseVersion.find(filter)
        .populate("categoryId", "name slug parentId")
        .sort(reviewSort)
        .skip(skip)
        .limit(limit)
        .lean(),
      CourseVersion.countDocuments(filter),
    ]);

    return {
      courses: versions.map((version) =>
        this.mapCourseReviewResponse(version as unknown as VersionLike),
      ),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  public async getAdminCourses(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    subscriptionStatus?: SubscriptionCatalogStatus;
    categoryId?: string;
    level?: string;
    instructorId?: string;
    sort?: string;
  }): Promise<{
    courses: AdminCourseListResponse[];
    total: number;
    page: number;
    totalPages: number;
    summary: {
      total: number;
      subscriptionApproved: number;
      subscriptionPending: number;
      withDraft: number;
    };
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const filter: Record<string, unknown> = {
      status: CourseStatus.PUBLISHED,
      currentVersionId: { $ne: null },
    };

    if (query.search?.trim()) {
      const search = query.search.trim();
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
        { instructorName: { $regex: search, $options: "i" } },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$_id" },
              regex: search,
              options: "i",
            },
          },
        },
      ];
    }
    if (query.subscriptionStatus)
      filter.subscriptionStatus = query.subscriptionStatus;
    if (query.categoryId && Types.ObjectId.isValid(query.categoryId)) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    if (query.level) filter.level = query.level;
    if (query.instructorId?.trim()) filter.instructorId = query.instructorId.trim();

    let sortOption: Record<string, 1 | -1> = { updatedAt: -1 };
    switch (query.sort) {
      case "newest":
        sortOption = { createdAt: -1 };
        break;
      case "updated":
        sortOption = { updatedAt: -1 };
        break;
      case "popular":
        sortOption = { enrollmentCount: -1, updatedAt: -1 };
        break;
      case "rating_desc":
        sortOption = { ratingAverage: -1, ratingCount: -1, updatedAt: -1 };
        break;
      case "price_asc":
        sortOption = { price: 1, updatedAt: -1 };
        break;
      case "price_desc":
        sortOption = { price: -1, updatedAt: -1 };
        break;
    }

    const [courses, total, summaryCounts] = await Promise.all([
      Course.find(filter)
        .populate("categoryId", "name slug parentId")
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Course.countDocuments(filter),
      Course.aggregate<{
        total: number;
        subscriptionApproved: number;
        subscriptionPending: number;
        withDraft: number;
      }>([
        {
          $match: {
            status: CourseStatus.PUBLISHED,
            currentVersionId: { $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            subscriptionApproved: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$subscriptionStatus",
                      SubscriptionCatalogStatus.APPROVED,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            withDraft: {
              $sum: {
                $cond: [{ $ne: ["$draftVersionId", null] }, 1, 0],
              },
            },
            subscriptionPending: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$subscriptionStatus",
                      SubscriptionCatalogStatus.PENDING,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const summary = summaryCounts[0] || {
      total: 0,
      subscriptionApproved: 0,
      subscriptionPending: 0,
      withDraft: 0,
    };

    return {
      courses: courses.map((course: any) =>
        this.mapAdminCourseListResponse(course),
      ),
      total,
      page,
      totalPages: Math.ceil(total / limit),
      summary,
    };
  }
  public async getCourseReviewDetail(
    versionId: string,
  ): Promise<CourseResponse> {
    const version = await CourseVersion.findById(versionId)
      .populate("categoryId", "name slug parentId")
      .lean();
    if (!version) throw new Error("Bản nội dung khóa học không tồn tại.");
    const shell = await Course.findById(version.courseId).lean();
    if (!shell) throw new Error("Khóa học gốc không tồn tại.");
    return this.buildVersionResponse(
      version._id.toString(),
      shell as unknown as CourseShellLike,
    );
  }

  public async approveCourse(
    versionId: string,
    admin: ReviewerSnapshot,
    options: { finalCategoryId?: string } = {},
  ): Promise<CourseReviewResponse> {
    const version = await CourseVersion.findById(versionId);
    if (!version) throw new Error("Bản nội dung khóa học không tồn tại.");
    if (version.status !== CourseStatus.PENDING)
      throw new Error("Chỉ khóa học đang chờ duyệt mới có thể phê duyệt.");

    const shell = await Course.findById(version.courseId);
    if (!shell) throw new Error("Khóa học gốc không tồn tại.");
    const previousVersionId = shell.currentVersionId?.toString() || "";

    const needsAdminClassification =
      version.categoryResolutionStatus ===
      CategoryResolutionStatus.NEEDS_ADMIN_CLASSIFICATION;
    if (needsAdminClassification && !options.finalCategoryId) {
      throw new Error(
        "Vui lòng chọn danh mục xuất bản trước khi phê duyệt khóa học.",
      );
    }
    if (options.finalCategoryId) {
      const finalCategory = await categoryService.resolveActiveCategoryById(
        options.finalCategoryId,
      );
      version.categoryId = finalCategory._id as Types.ObjectId;
      version.categoryResolutionStatus = CategoryResolutionStatus.NONE;
      version.suggestedCategoryName = "";
      version.suggestedCategoryNote = "";
    } else if (!version.categoryId) {
      throw new Error("Khóa học chưa có danh mục xuất bản hợp lệ.");
    } else {
      await categoryService.resolveActiveCategoryById(
        version.categoryId.toString(),
      );
      version.categoryResolutionStatus = CategoryResolutionStatus.NONE;
      version.suggestedCategoryName = "";
      version.suggestedCategoryNote = "";
    }

    // Approve bản cập nhật: version cũ thành ARCHIVED, version mới thành currentVersionId.
    if (
      shell.currentVersionId &&
      shell.currentVersionId.toString() !== version._id.toString()
    ) {
      await CourseVersion.findByIdAndUpdate(shell.currentVersionId, {
        $set: { status: CourseStatus.ARCHIVED },
      });
    }

    version.status = CourseStatus.PUBLISHED;
    version.reviewedAt = new Date();
    version.reviewedBy = admin.adminId;
    version.reviewedByName = admin.adminName;
    version.reviewedByEmail = admin.adminEmail;
    version.rejectionReason = "";
    await version.save();

    shell.currentVersionId = version._id as Types.ObjectId;
    shell.draftVersionId = null;
    shell.status = CourseStatus.PUBLISHED;
    await this.syncShellDraftCache(shell._id.toString(), version, shell);
    // Sau khi public version mới, xóa media chỉ còn nằm trong archived versions.
    await mediaReferenceService.cleanupArchivedVersionMedia(
      shell._id as Types.ObjectId,
    );

    // Phát event thông báo khóa học đã được xuất bản để downstream cập nhật index/cache.
    try {
      await publishCoursePublished({
        courseId: shell._id.toString(),
        versionId: version._id.toString(),
        title: version.title,
        slug: version.slug,
        instructorId: version.instructorId,
        finalCategoryId: version.categoryId
          ? version.categoryId.toString()
          : undefined,
        publishedAt: version.reviewedAt
          ? version.reviewedAt.toISOString()
          : new Date().toISOString(),
      });
    } catch (err) {
      // Không block publish nếu event broker gặp lỗi; log và tiếp tục.
      console.error("Failed to publish COURSE_PUBLISHED event", err);
    }

    if (previousVersionId && previousVersionId !== version._id.toString()) {
      try {
        await publishCourseVersionPublished({
          courseId: shell._id.toString(),
          oldVersionId: previousVersionId,
          newVersionId: version._id.toString(),
          totalLessons: version.totalLessons || 0,
          publishedAt: version.reviewedAt
            ? version.reviewedAt.toISOString()
            : new Date().toISOString(),
          lessonMappings: await this.buildVersionLessonMappings(
            previousVersionId,
            version._id.toString(),
          ),
        });
      } catch (err) {
        console.error("Failed to publish COURSE_VERSION_PUBLISHED event", err);
      }
    }

    const approved = await CourseVersion.findById(version._id)
      .populate("categoryId", "name slug parentId")
      .lean();
    return this.mapCourseReviewResponse(approved as unknown as VersionLike);
  }

  public async rejectCourse(
    versionId: string,
    admin: ReviewerSnapshot,
    reason: string,
  ): Promise<CourseReviewResponse> {
    const normalizedReason = reason?.trim();
    if (!normalizedReason) throw new Error("Vui lòng nhập góp ý chỉnh sửa.");

    const version = await CourseVersion.findById(versionId);
    if (!version) throw new Error("Bản nội dung khóa học không tồn tại.");
    if (version.status !== CourseStatus.PENDING)
      throw new Error(
        "Chỉ khóa học đang chờ duyệt mới có thể yêu cầu chỉnh sửa.",
      );

    // Reject không đụng vào currentVersion public; instructor sửa lại chính version này rồi gửi duyệt lại.
    version.status = CourseStatus.REJECTED;
    version.reviewedAt = new Date();
    version.reviewedBy = admin.adminId;
    version.reviewedByName = admin.adminName;
    version.reviewedByEmail = admin.adminEmail;
    version.rejectionReason = normalizedReason;
    await version.save();

    try {
      await publishCourseRejected({
        courseId: version.courseId.toString(),
        versionId: version._id.toString(),
        title: version.title,
        instructorId: version.instructorId,
        reason: normalizedReason,
        rejectedAt: version.reviewedAt.toISOString(),
      });
    } catch (err) {
      console.error('Failed to publish COURSE_REJECTED event', err);
    }

    const shell = await Course.findById(version.courseId);
    if (shell && shell.status !== CourseStatus.PUBLISHED) {
      shell.status = CourseStatus.REJECTED;
      await shell.save();
    }

    const rejected = await CourseVersion.findById(version._id)
      .populate("categoryId", "name slug parentId")
      .lean();
    return this.mapCourseReviewResponse(rejected as unknown as VersionLike);
  }

  public async getPublishedCourses(query: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    level?: string;
    minPrice?: number;
    maxPrice?: number;
    rating?: number;
    minDuration?: number; // seconds
    maxDuration?: number; // seconds
    sort?: string;
    instructorId?: string;
    ids?: string;
  }): Promise<{
    courses: CourseResponse[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 12, 1), 50);
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = {
      status: CourseStatus.PUBLISHED,
      currentVersionId: { $ne: null },
    };

    if (query.instructorId) filter.instructorId = query.instructorId;
    if (query.ids) {
      const ids = query.ids.split(',').map((id) => id.trim()).filter((id) => Types.ObjectId.isValid(id)).slice(0, 50);
      filter._id = { $in: ids };
    }

    if (query.search)
      filter.$or = [
        { title: { $regex: query.search, $options: "i" } },
        { description: { $regex: query.search, $options: "i" } },
      ];
    if (query.category) {
      const slugs = query.category
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const allCategoryIds: string[] = [];
      for (const slug of slugs) {
        try {
          const category =
            await categoryService.resolveActiveCategorySlug(slug);
          const categoryIds = await categoryService.getDescendantAndSelfIds(
            category._id.toString(),
          );
          allCategoryIds.push(...categoryIds);
        } catch (error) {
          // Ignore invalid slugs
        }
      }
      if (allCategoryIds.length > 0) {
        filter.categoryId = { $in: allCategoryIds };
      }
    }
    if (query.level) {
      const levels = query.level
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (levels.length > 0) {
        filter.level = { $in: levels };
      }
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {};
      if (query.minPrice !== undefined)
        (filter.price as any).$gte = query.minPrice;
      if (query.maxPrice !== undefined)
        (filter.price as any).$lte = query.maxPrice;
    }

    if (query.rating !== undefined) {
      filter.ratingAverage = { $gte: query.rating };
    }

    if (query.minDuration !== undefined || query.maxDuration !== undefined) {
      filter.totalDuration = {};
      if (query.minDuration !== undefined)
        (filter.totalDuration as any).$gte = query.minDuration;
      if (query.maxDuration !== undefined)
        (filter.totalDuration as any).$lte = query.maxDuration;
    }

    let sortOption: any = { createdAt: -1 };
    switch (query.sort) {
      case "newest":
        sortOption = { createdAt: -1 };
        break;
      case "popular":
        sortOption = { enrollmentCount: -1 };
        break;
      case "price_asc":
        sortOption = { price: 1 };
        break;
      case "price_desc":
        sortOption = { price: -1 };
        break;
      case "rating_desc":
      case "top_rated":
        sortOption = { ratingAverage: -1, ratingCount: -1, createdAt: -1 };
        break;
    }

    // Public catalog chỉ lấy Course shell đã PUBLISHED rồi hydrate nội dung từ currentVersionId.
    const [shells, total] = await Promise.all([
      Course.find(filter).sort(sortOption).skip(skip).limit(limit).lean(),
      Course.countDocuments(filter),
    ]);

    const responses = await Promise.all(
      shells.map(async (shell) =>
        this.sanitizePublicCourse(
          await this.buildVersionResponse(
            shell.currentVersionId!.toString(),
            shell as unknown as CourseShellLike,
            true,
          ),
        ),
      ),
    );
    responses.forEach((response, index) => {
      response._id = shells[index]._id.toString();
    });
    return {
      courses: responses,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  public async getCourseBySlug(slug: string): Promise<CourseResponse> {
    const shell = await Course.findOne({
      slug,
      status: CourseStatus.PUBLISHED,
      currentVersionId: { $ne: null },
    }).lean();
    if (!shell)
      throw new Error("Khóa học không tồn tại hoặc chưa được xuất bản.");
    const response = this.sanitizePublicCourse(
      await this.buildVersionResponse(
        shell.currentVersionId!.toString(),
        shell as unknown as CourseShellLike,
        true,
      ),
    );
    response._id = shell._id.toString();
    return response;
  }

  public async getSubscriptionReviewCourses(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: SubscriptionCatalogStatus;
    sort?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const filter: Record<string, unknown> = {
      status: CourseStatus.PUBLISHED,
      currentVersionId: { $ne: null },
      subscriptionStatus: query.status || SubscriptionCatalogStatus.PENDING,
    };
    if (query.search?.trim()) {
      filter.$or = [
        { title: { $regex: query.search.trim(), $options: "i" } },
        { instructorName: { $regex: query.search.trim(), $options: "i" } },
      ];
    }

    const subscriptionSortOptions: Record<string, Record<string, 1 | -1>> = {
      submitted_desc: { updatedAt: -1 },
      submitted_asc: { updatedAt: 1 },
      title_asc: { title: 1, updatedAt: -1 },
      title_desc: { title: -1, updatedAt: -1 },
    };
    const subscriptionSort = subscriptionSortOptions[query.sort || 'submitted_desc'] || subscriptionSortOptions.submitted_desc;

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .populate("categoryId", "name slug parentId")
        .sort(subscriptionSort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Course.countDocuments(filter),
    ]);
    const videoCounts = await Lesson.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      {
        $match: {
          courseId: {
            $in: courses.map((course: any) => course.currentVersionId),
          },
          type: LessonType.VIDEO,
        },
      },
      { $group: { _id: "$courseId", count: { $sum: 1 } } },
    ]);
    const videoCountByVersion = new Map(
      videoCounts.map((item) => [item._id.toString(), item.count]),
    );

    return {
      courses: courses.map((course: any) => ({
        _id: course._id.toString(),
        title: course.title,
        slug: course.slug,
        thumbnailUrl: course.thumbnail || "",
        instructor: {
          _id: course.instructorId,
          fullName: course.instructorName || "",
          email: "",
        },
        category: course.categoryId?.name || "",
        categoryId: course.categoryId?._id?.toString() || null,
        level: course.level,
        price: course.price,
        status: course.status,
        totalLessons: course.totalLessons || 0,
        totalVideos:
          videoCountByVersion.get(course.currentVersionId?.toString()) || 0,
        totalChapters: course.totalSections || 0,
        totalDuration: Math.round((course.totalDuration || 0) / 60),
        subscriptionStatus: course.subscriptionStatus,
        subscriptionReviewReason: course.subscriptionReviewReason || "",
        subscriptionReviewedAt: course.subscriptionReviewedAt || null,
        subscriptionReviewedByAdmin: course.subscriptionReviewedBy
          ? {
              _id: course.subscriptionReviewedBy,
              fullName: course.subscriptionReviewedByName || "",
              email: course.subscriptionReviewedByEmail || "",
            }
          : undefined,
        createdAt: course.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  public async getSubscriptionReviewDetail(
    courseId: string,
  ): Promise<CourseResponse> {
    const shell = await Course.findById(courseId).lean();
    if (!shell?.currentVersionId || shell.status !== CourseStatus.PUBLISHED) {
      throw new Error("Khóa học đã xuất bản không tồn tại.");
    }
    return this.buildVersionResponse(
      shell.currentVersionId.toString(),
      shell as unknown as CourseShellLike,
    );
  }

  public async getCourseForLearning(
    courseId: string,
    userId: string,
    userRole: string,
  ): Promise<CourseResponse> {
    // Entry khi learner mở màn học.
    // Hàm này chỉ trả curriculum thật nếu user còn entitlement; với mua đứt thì entitlement thường tới từ Enrollment source PURCHASE.
    const shell = await Course.findOne({
      _id: courseId,
      status: CourseStatus.PUBLISHED,
      currentVersionId: { $ne: null },
    }).lean();
    if (!shell) throw new Error("Khóa học không tồn tại hoặc chưa xuất bản.");
    const isOwner = userRole === "INSTRUCTOR" && shell.instructorId === userId;
    // Learner cần enrollment hợp lệ; instructor sở hữu khóa học được vào để hỗ trợ thảo luận.
    const access = isOwner
      ? { allowed: true, source: undefined, accessEndsAt: null }
      : await subscriptionAccessService.entitlement(userId, courseId);
    if (!access.allowed)
      throw new Error("Bạn không còn quyền truy cập nội dung khóa học.");
    const response = await this.buildVersionResponse(
      shell.currentVersionId!.toString(),
      shell as unknown as CourseShellLike,
      true,
    );
    response._id = shell._id.toString();
    response.accessSource = access.source;
    response.accessEndsAt = access.accessEndsAt || null;
    return response;
  }

  public async getOwnedCourseOrThrow(
    versionId: string,
    instructorId: string,
    populateCategory = false,
  ) {
    const { version } = await this.getOwnedVersionOrThrow(
      versionId,
      instructorId,
      populateCategory,
    );
    return version;
  }

  public async getOwnedVersionOrThrow(
    versionId: string,
    instructorId: string,
    populateCategory = false,
  ) {
    const query = CourseVersion.findById(versionId);
    if (populateCategory) query.populate("categoryId", "name slug parentId");
    const version = await query;
    if (!version) throw new Error("Bản nội dung khóa học không tồn tại.");
    if (version.instructorId !== instructorId)
      throw new Error("Bạn không có quyền truy cập khóa học này.");
    const shell = await Course.findById(version.courseId);
    if (!shell) throw new Error("Khóa học gốc không tồn tại.");
    return { version, shell };
  }

  public assertCourseEditable(status: string): void {
    if (
      ![CourseStatus.DRAFT, CourseStatus.REJECTED].includes(
        status as CourseStatus,
      )
    ) {
      throw new Error(
        "Khóa học đang chờ duyệt hoặc đã xuất bản không thể chỉnh sửa trực tiếp.",
      );
    }
  }

  public async syncCourseStats(
    versionId: Types.ObjectId | string,
  ): Promise<void> {
    const normalizedVersionId =
      typeof versionId === "string" ? new Types.ObjectId(versionId) : versionId;
    const [sections, lessons] = await Promise.all([
      Section.find({ courseId: normalizedVersionId }).select("_id").lean(),
      Lesson.find({ courseId: normalizedVersionId }).select("duration").lean(),
    ]);
    const totalDuration = lessons.reduce(
      (sum, lesson) => sum + (lesson.duration || 0),
      0,
    );
    const version = await CourseVersion.findByIdAndUpdate(
      normalizedVersionId,
      {
        $set: {
          totalSections: sections.length,
          totalLessons: lessons.length,
          totalDuration,
        },
      },
      { new: true },
    );
    if (version)
      await this.syncShellDraftCache(version.courseId.toString(), version);
  }

  // Cache metadata lên Course shell để list/filter nhanh.
  // Nếu course đã PUBLISHED, chỉ currentVersion mới được phép cập nhật cache public.
  private async syncShellDraftCache(
    courseId: string,
    version: Pick<
      ICourseVersion,
      | "_id"
      | "title"
      | "shortDescription"
      | "description"
      | "thumbnail"
      | "whatYouWillLearn"
      | "requirements"
      | "categoryId"
      | "categoryResolutionStatus"
      | "suggestedCategoryName"
      | "suggestedCategoryNote"
      | "level"
      | "progressionMode"
      | "price"
      | "totalDuration"
      | "totalLessons"
      | "totalSections"
    >,
    shellDoc?: ICourse,
  ): Promise<void> {
    const shell = shellDoc || (await Course.findById(courseId));
    if (!shell) return;
    const shouldUpdateCache =
      shell.status !== CourseStatus.PUBLISHED ||
      shell.currentVersionId?.toString() === version._id.toString();
    if (!shouldUpdateCache) return;

    shell.title = version.title;
    shell.shortDescription = version.shortDescription || "";
    shell.description = version.description;
    shell.thumbnail = version.thumbnail;
    shell.whatYouWillLearn = version.whatYouWillLearn || [];
    shell.requirements = version.requirements || [];
    shell.categoryId = version.categoryId ?? null;
    shell.categoryResolutionStatus =
      version.categoryResolutionStatus || CategoryResolutionStatus.NONE;
    shell.suggestedCategoryName = version.suggestedCategoryName || "";
    shell.suggestedCategoryNote = version.suggestedCategoryNote || "";
    shell.level = version.level;
    shell.progressionMode = version.progressionMode || CourseProgressionMode.FREE;
    shell.price = version.price;
    shell.totalDuration = version.totalDuration;
    shell.totalLessons = version.totalLessons;
    shell.totalSections = version.totalSections || 0;
    await shell.save();
  }

  private formatPublishValidationMessage(
    errors: Array<{ field: string; message: string; sectionId?: string }>,
    sectionErrorGroups: Map<string, { title: string; items: string[] }>,
  ): string {
    if (errors.length === 0) return "";
    const maxItems = 8;
    let visibleCount = 0;
    const lines = ["Khóa học chưa thể gửi duyệt:"];

    for (const error of errors.filter((item) => !item.sectionId)) {
      if (visibleCount >= maxItems) break;
      lines.push(`• ${error.message}`);
      visibleCount += 1;
    }

    for (const group of sectionErrorGroups.values()) {
      if (visibleCount >= maxItems) break;
      lines.push(`• ${group.title}`);
      for (const item of group.items) {
        if (visibleCount >= maxItems) break;
        lines.push(`  - ${item}`);
        visibleCount += 1;
      }
    }

    const remainingCount = errors.length - visibleCount;
    if (remainingCount > 0) lines.push(`...và ${remainingCount} lỗi khác.`);
    return lines.join("\n");
  }

  private async buildVersionResponse(
    versionId: string,
    shell: CourseShellLike | ICourse,
    includeSections = true,
  ): Promise<CourseResponse> {
    const version = await CourseVersion.findById(versionId)
      .populate("categoryId", "name slug parentId")
      .lean();
    if (!version) throw new Error("Bản nội dung khóa học không tồn tại.");
    const sections = includeSections
      ? await this.loadCourseSections(version._id.toString())
      : [];
    return this.mapVersionResponse(
      version as unknown as VersionLike,
      shell as unknown as CourseShellLike,
      sections,
    );
  }

  private async copyCurriculum(
    sourceVersionId: Types.ObjectId,
    targetVersionId: Types.ObjectId,
  ): Promise<void> {
    // Clone curriculum sang version mới: tạo Section/Lesson/Quiz mới nhưng giữ video/document assetId.
    // Media cũ chỉ bị xóa khi version cũ archived và không còn active version nào tham chiếu.
    const [sections, lessons] = await Promise.all([
      Section.find({ courseId: sourceVersionId })
        .sort({ order: 1, createdAt: 1 })
        .lean(),
      Lesson.find({ courseId: sourceVersionId })
        .sort({ order: 1, createdAt: 1 })
        .lean(),
    ]);

    const sectionIdMap = new Map<string, Types.ObjectId>();
    const lessonIdMap = new Map<string, Types.ObjectId>();
    for (const section of sections) {
      const createdSection = await Section.create({
        courseId: targetVersionId,
        title: section.title,
        order: section.order,
      });
      sectionIdMap.set(
        section._id.toString(),
        createdSection._id as Types.ObjectId,
      );
    }

    for (const lesson of lessons) {
      const targetSectionId = sectionIdMap.get(lesson.sectionId.toString());
      if (!targetSectionId) continue;
      const createdLesson = await Lesson.create({
        courseId: targetVersionId,
        sectionId: targetSectionId,
        sourceLessonId: lesson.sourceLessonId ?? lesson._id,
        title: lesson.title,
        type: lesson.type,
        status: lesson.status,
        content: lesson.content,
        duration: lesson.duration,
        order: lesson.order,
        isFreePreview: lesson.isFreePreview,
        videoAssetId: lesson.videoAssetId ?? null,
        attachments: lesson.attachments || [],
      });
      lessonIdMap.set(
        lesson._id.toString(),
        createdLesson._id as Types.ObjectId,
      );
    }

    const quizzes = await Quiz.find({ courseId: sourceVersionId }).lean();
    for (const quiz of quizzes) {
      const targetLessonId = lessonIdMap.get(quiz.lessonId.toString());
      if (!targetLessonId) continue;
      await Quiz.create({
        courseId: targetVersionId,
        lessonId: targetLessonId,
        title: quiz.title,
        passingScore: quiz.passingScore,
        questions: quiz.questions,
      });
    }
  }

  private async buildVersionLessonMappings(
    oldVersionId: string,
    newVersionId: string,
  ) {
    const newVersion = await CourseVersion.findById(newVersionId).select("courseId").lean();
    if (!newVersion) return [];
    const historicalVersions = await CourseVersion.find({
      courseId: newVersion.courseId,
      _id: { $ne: newVersion._id },
    }).select("_id").lean();
    const historicalVersionIds = historicalVersions.map((version) => version._id);
    const [oldSections, newSections, oldLessons, newLessons, historicalLessons] = await Promise.all([
      Section.find({ courseId: oldVersionId }).select("_id order").lean(),
      Section.find({ courseId: newVersionId }).select("_id order").lean(),
      Lesson.find({ courseId: oldVersionId }).select("_id sectionId sourceLessonId type order").lean(),
      Lesson.find({ courseId: newVersionId }).select("_id sectionId sourceLessonId type order").lean(),
      historicalVersionIds.length
        ? Lesson.find({ courseId: { $in: historicalVersionIds } }).select("_id sourceLessonId type").lean()
        : Promise.resolve([]),
    ]);
    const oldSectionOrderById = new Map(oldSections.map((section) => [section._id.toString(), section.order]));
    const newSectionOrderById = new Map(newSections.map((section) => [section._id.toString(), section.order]));
    const oldByIdentity = new Map<string, typeof oldLessons[number]>();
    const oldByPosition = new Map<string, typeof oldLessons[number]>();

    for (const lesson of oldLessons) {
      const identity = (lesson.sourceLessonId || lesson._id).toString();
      oldByIdentity.set(identity, lesson);
      oldByPosition.set(
        `${oldSectionOrderById.get(lesson.sectionId.toString()) || 0}:${lesson.order}:${lesson.type}`,
        lesson,
      );
    }

    const mappings = new Map<string, {
      oldLessonId: string;
      newLessonId: string;
      lessonType: LessonType;
    }>();

    for (const lesson of newLessons) {
      const identity = lesson.sourceLessonId?.toString();
      const matched = identity
        ? oldByIdentity.get(identity)
        : oldByPosition.get(
            `${newSectionOrderById.get(lesson.sectionId.toString()) || 0}:${lesson.order}:${lesson.type}`,
          );
      if (matched) {
        mappings.set(`${matched._id.toString()}:${lesson._id.toString()}`, {
          oldLessonId: matched._id.toString(),
          newLessonId: lesson._id.toString(),
          lessonType: lesson.type,
        });
      }

      const targetIdentity = (lesson.sourceLessonId || lesson._id).toString();
      for (const historicalLesson of historicalLessons) {
        const historicalIdentity = (historicalLesson.sourceLessonId || historicalLesson._id).toString();
        if (historicalIdentity !== targetIdentity || historicalLesson.type !== lesson.type) continue;
        mappings.set(`${historicalLesson._id.toString()}:${lesson._id.toString()}`, {
          oldLessonId: historicalLesson._id.toString(),
          newLessonId: lesson._id.toString(),
          lessonType: lesson.type,
        });
      }
    }

    return Array.from(mappings.values()).filter((mapping) => mapping.oldLessonId !== mapping.newLessonId);
  }

  private async loadCourseSections(
    versionId: string,
  ): Promise<CourseResponse["sections"]> {
    const versionObjectId = new Types.ObjectId(versionId);
    const [sections, lessons] = await Promise.all([
      Section.find({ courseId: versionObjectId })
        .sort({ order: 1, createdAt: 1 })
        .lean(),
      Lesson.find({ courseId: versionObjectId })
        .sort({ order: 1, createdAt: 1 })
        .lean(),
    ]);

    const lessonIds = lessons.map((lesson) => lesson._id);
    const quizzes = lessonIds.length
      ? await Quiz.find({
          courseId: versionObjectId,
          lessonId: { $in: lessonIds },
        })
          .select("lessonId questions")
          .lean()
      : [];
    const quizMetaByLessonId = new Map<
      string,
      { quizId: string; questionCount: number }
    >();
    for (const quiz of quizzes) {
      quizMetaByLessonId.set(quiz.lessonId.toString(), {
        quizId: quiz._id.toString(),
        questionCount: quiz.questions.length,
      });
    }

    const lessonsBySectionId = new Map<string, CourseLessonResponse[]>();
    for (const lesson of lessons) {
      const bucket = lessonsBySectionId.get(lesson.sectionId.toString()) || [];
      const quizMeta = quizMetaByLessonId.get(lesson._id.toString());
      bucket.push({
        _id: lesson._id.toString(),
        title: lesson.title,
        type: lesson.type,
        status: lesson.status,
        content: lesson.content || "",
        duration: lesson.duration,
        order: lesson.order,
        isFreePreview: lesson.isFreePreview,
        videoAssetId: lesson.videoAssetId
          ? lesson.videoAssetId.toString()
          : null,
        attachments: (lesson.attachments || []).map((id) => id.toString()),
        quizId: quizMeta?.quizId || null,
        contentMeta:
          lesson.type === LessonType.QUIZ
            ? { questionCount: quizMeta?.questionCount || 0 }
            : null,
      });
      lessonsBySectionId.set(lesson.sectionId.toString(), bucket);
    }

    return sections.map((section) => ({
      _id: section._id.toString(),
      title: section.title,
      order: section.order,
      lessons: lessonsBySectionId.get(section._id.toString()) || [],
    }));
  }

  private mapVersionResponse(
    version: VersionLike,
    shell: CourseShellLike,
    sections: CourseResponse["sections"],
  ): CourseResponse {
    const category =
      version.categoryId &&
      typeof version.categoryId === "object" &&
      "slug" in version.categoryId
        ? {
            _id: version.categoryId._id.toString(),
            name: version.categoryId.name,
            slug: version.categoryId.slug,
            parentId: version.categoryId.parentId
              ? version.categoryId.parentId.toString()
              : null,
          }
        : null;
    const reviewedByAdmin = this.mapReviewerSnapshot(version);
    const totalQuizzes = sections.reduce(
      (sum, section) => sum + section.lessons.filter((lesson) => lesson.type === LessonType.QUIZ).length,
      0,
    );
    const totalDocuments = sections.reduce(
      (sum, section) =>
        sum + section.lessons.reduce((lessonSum, lesson) => lessonSum + lesson.attachments.length, 0),
      0,
    );

    return {
      _id: version._id.toString(),
      courseId: shell._id.toString(),
      title: version.title,
      slug: shell.slug || version.slug,
      shortDescription: version.shortDescription || "",
      description: version.description,
      thumbnail: version.thumbnail,
      whatYouWillLearn: version.whatYouWillLearn || [],
      requirements: version.requirements || [],
      instructorId: version.instructorId,
      instructorName: version.instructorName,
      instructorProfile: {
        avatarUrl: shell.instructorAvatarUrl || "",
        bio: shell.instructorBio || "",
      },
      categoryId:
        category?._id ||
        (version.categoryId ? version.categoryId.toString() : null),
      category,
      categoryResolutionStatus:
        version.categoryResolutionStatus || CategoryResolutionStatus.NONE,
      suggestedCategoryName: version.suggestedCategoryName || "",
      suggestedCategoryNote: version.suggestedCategoryNote || "",
      level: version.level,
      progressionMode: version.progressionMode || CourseProgressionMode.FREE,
      status: version.status,
      submittedAt: version.submittedAt || null,
      reviewedAt: version.reviewedAt || null,
      reviewedBy: version.reviewedBy || "",
      ...(reviewedByAdmin && { reviewedByAdmin }),
      rejectionReason: version.rejectionReason || "",
      price: version.price,
      sections,
      totalDuration: version.totalDuration,
      totalLessons: version.totalLessons,
      totalSections: version.totalSections || 0,
      totalQuizzes,
      totalDocuments,
      enrollmentCount: shell.enrollmentCount,
      rating: shell.ratingAverage || 0,
      reviews: shell.ratingCount || 0,
      subscriptionStatus:
        shell.subscriptionStatus || SubscriptionCatalogStatus.NOT_OPTED_IN,
      subscriptionReviewReason: shell.subscriptionReviewReason || "",
      subscriptionReviewedAt: shell.subscriptionReviewedAt || null,
      ...(shell.subscriptionReviewedBy && {
        subscriptionReviewedByAdmin: {
          _id: shell.subscriptionReviewedBy,
          fullName: shell.subscriptionReviewedByName || "",
          email: shell.subscriptionReviewedByEmail || "",
        },
      }),
      isRevision: version.versionNumber > 1,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
    };
  }

  private sanitizePublicCourse(course: CourseResponse): CourseResponse {
    // Public detail chỉ lộ preview metadata; asset/document/quiz thật phải đi qua entitlement riêng.
    return {
      ...course,
      sections: course.sections.map((section) => ({
        ...section,
        lessons: section.lessons.map((lesson) =>
          lesson.isFreePreview
            ? lesson
            : {
                ...lesson,
                content: "",
                videoAssetId: null,
                attachments: [],
                quizId: null,
                contentMeta: null,
              },
        ),
      })),
    };
  }

  private mapActiveRevision(version: VersionLike) {
    return {
      _id: version._id.toString(),
      status: version.status,
      rejectionReason: version.rejectionReason || "",
      submittedAt: version.submittedAt || null,
      updatedAt: version.updatedAt,
    };
  }

  private mapCourseReviewResponse(version: VersionLike): CourseReviewResponse {
    const category =
      version.categoryId &&
      typeof version.categoryId === "object" &&
      "slug" in version.categoryId
        ? version.categoryId.name
        : "";
    const categoryId =
      version.categoryId &&
      typeof version.categoryId === "object" &&
      "slug" in version.categoryId
        ? version.categoryId._id.toString()
        : version.categoryId
          ? version.categoryId.toString()
          : null;
    const categorySlug =
      version.categoryId &&
      typeof version.categoryId === "object" &&
      "slug" in version.categoryId
        ? version.categoryId.slug
        : "";
    const reviewedByAdmin = this.mapReviewerSnapshot(version);
    return {
      _id: version._id.toString(),
      title: version.title,
      slug: version.slug,
      description: version.description,
      thumbnailUrl: version.thumbnail,
      instructor: {
        _id: version.instructorId,
        fullName: version.instructorName,
        email: "",
      },
      category,
      categoryId,
      categorySlug,
      categoryResolutionStatus:
        version.categoryResolutionStatus || CategoryResolutionStatus.NONE,
      suggestedCategoryName: version.suggestedCategoryName || "",
      suggestedCategoryNote: version.suggestedCategoryNote || "",
      level: version.level,
      price: version.price,
      status: version.status,
      totalLessons: version.totalLessons,
      totalChapters: version.totalSections || 0,
      totalDuration: Math.round((version.totalDuration || 0) / 60),
      submittedAt: version.submittedAt || null,
      reviewedAt: version.reviewedAt || null,
      reviewedBy: version.reviewedBy || "",
      ...(reviewedByAdmin && { reviewedByAdmin }),
      rejectionReason: version.rejectionReason || "",
      createdAt: version.createdAt,
      isRevision: version.versionNumber > 1,
      courseId: version.courseId.toString(),
    };
  }

  private mapAdminCourseListResponse(course: any): AdminCourseListResponse {
    const category =
      course.categoryId &&
      typeof course.categoryId === "object" &&
      "slug" in course.categoryId
        ? {
            _id: course.categoryId._id.toString(),
            name: course.categoryId.name || "",
            slug: course.categoryId.slug || "",
            parentId: course.categoryId.parentId
              ? course.categoryId.parentId.toString()
              : null,
          }
        : null;

    return {
      _id: course._id.toString(),
      title: course.title || "",
      slug: course.slug || "",
      thumbnail: course.thumbnail || "",
      instructorId: course.instructorId || "",
      instructorName: course.instructorName || "",
      category,
      level: course.level,
      status: course.status,
      subscriptionStatus:
        course.subscriptionStatus || SubscriptionCatalogStatus.NOT_OPTED_IN,
      price: course.price || 0,
      totalLessons: course.totalLessons || 0,
      totalSections: course.totalSections || 0,
      totalDuration: course.totalDuration || 0,
      enrollmentCount: course.enrollmentCount || 0,
      ratingAverage: course.ratingAverage || 0,
      ratingCount: course.ratingCount || 0,
      currentVersionId: course.currentVersionId
        ? course.currentVersionId.toString()
        : null,
      draftVersionId: course.draftVersionId
        ? course.draftVersionId.toString()
        : null,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
  private mapReviewerSnapshot(version: VersionLike) {
    if (!version.reviewedBy) return undefined;
    return {
      _id: version.reviewedBy,
      fullName: version.reviewedByName || "",
      email: version.reviewedByEmail || "",
    };
  }
}

export default new CourseService();
