// ========================
// File này chứa service trung tâm của course-service.
// Vai trò chính:
// - quản lý metadata khóa học
// - dựng response course cho editor/public
// - đồng bộ thống kê course
// - kiểm tra điều kiện publish
// Lưu ý:
// - hướng mới là CRUD section/lesson riêng, không còn đặt nặng flow replace toàn bộ curriculum
// - validate publish đang là chốt nghiệp vụ chính trước khi cho publish course
// ========================
import { Types } from 'mongoose';
import { Course, ICourse, CourseStatus } from '../models/course.model';
import { Lesson, LessonStatus, LessonType } from '../models/lesson.model';
import { Quiz } from '../models/quiz.model';
import { Section } from '../models/section.model';
import { publishCourseCreated } from '../events/publishers';
import categoryService from './category.service';

interface CourseLessonResponse {
  _id: string;
  title: string;
  type: string;
  status: string;
  summary: string;
  duration: number;
  order: number;
  isFreePreview: boolean;
  videoAssetId: string | null;
  documentAssetId: string | null;
  quizId: string | null;
  contentMeta: {
    questionCount?: number;
  } | null;
}

interface CourseResponse {
  _id: string;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  thumbnail: string;
  whatYouWillLearn: string[];
  requirements: string[];
  instructorId: string;
  instructorName: string;
  categoryId: string | null;
  category: {
    _id: string;
    name: string;
    slug: string;
    parentId: string | null;
  } | null;
  level: string;
  status: string;
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
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type CourseDocumentLike = {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  shortDescription?: string;
  description: string;
  thumbnail: string;
  whatYouWillLearn?: string[];
  requirements?: string[];
  instructorId: string;
  instructorName: string;
  categoryId?:
    | (Types.ObjectId & { name?: never })
    | {
        _id: Types.ObjectId;
        name: string;
        slug: string;
        parentId?: Types.ObjectId | null;
      }
    | null;
  level: string;
  status: string;
  price: number;
  totalDuration: number;
  totalLessons: number;
  totalSections?: number;
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
};

class CourseService {
  // Rule publish hiện tại:
  // - course phải có title, thumbnail, category
  // - phải có ít nhất 1 section
  // - mỗi section phải có ít nhất 1 lesson
  // - lesson phải READY
  // - VIDEO cần videoAssetId, DOCUMENT cần documentAssetId, QUIZ cần có quiz + ít nhất 1 câu hỏi
  public async validateCoursePublish(courseId: string, instructorId: string) {
    const course = await Course.findById(courseId).lean();
    if (!course) throw new Error('Khóa học không tồn tại.');
    if (course.instructorId !== instructorId) throw new Error('Bạn không có quyền truy cập khóa học này.');

    const errors: Array<{ field: string; message: string; sectionId?: string; lessonId?: string }> = [];

    if (!course.title?.trim()) errors.push({ field: 'title', message: 'Khóa học chưa có tiêu đề.' });
    if (!course.thumbnail?.trim()) errors.push({ field: 'thumbnail', message: 'Khóa học chưa có ảnh đại diện.' });
    if (!course.categoryId) errors.push({ field: 'categoryId', message: 'Khóa học chưa có danh mục.' });

    const [sections, lessons] = await Promise.all([
      Section.find({ courseId }).sort({ order: 1 }).lean(),
      Lesson.find({ courseId }).sort({ order: 1 }).lean(),
    ]);

    if (sections.length === 0) {
      errors.push({ field: 'sections', message: 'Khóa học phải có ít nhất 1 chương.' });
    }

    const lessonIds = lessons.map((lesson) => lesson._id);
    const quizzes = lessonIds.length > 0
      ? await Quiz.find({ courseId, lessonId: { $in: lessonIds } }).select('lessonId questions').lean()
      : [];
    const quizByLessonId = new Map(quizzes.map((quiz) => [quiz.lessonId.toString(), quiz]));

    for (const section of sections) {
      const sectionLessons = lessons.filter((lesson) => lesson.sectionId.toString() === section._id.toString());
      if (sectionLessons.length === 0) {
        errors.push({
          field: 'section.lessons',
          message: `Chương "${section.title}" chưa có bài học nào.`,
          sectionId: section._id.toString(),
        });
      }

      for (const lesson of sectionLessons) {
        if (lesson.status !== LessonStatus.READY) {
          errors.push({
            field: 'lesson.status',
            message: `Bài học "${lesson.title}" chưa sẵn sàng.`,
            sectionId: section._id.toString(),
            lessonId: lesson._id.toString(),
          });
        }

        if (lesson.type === LessonType.VIDEO && !lesson.videoAssetId) {
          errors.push({
            field: 'lesson.videoAssetId',
            message: `Bài học "${lesson.title}" chưa gắn video asset.`,
            sectionId: section._id.toString(),
            lessonId: lesson._id.toString(),
          });
        }

        if (lesson.type === LessonType.DOCUMENT && !lesson.documentAssetId) {
          errors.push({
            field: 'lesson.documentAssetId',
            message: `Bài học "${lesson.title}" chưa gắn tài liệu.`,
            sectionId: section._id.toString(),
            lessonId: lesson._id.toString(),
          });
        }

        if (lesson.type === LessonType.QUIZ) {
          const quiz = quizByLessonId.get(lesson._id.toString());
          if (!quiz) {
            errors.push({
              field: 'quiz.lessonId',
              message: `Bài học "${lesson.title}" chưa có quiz.`,
              sectionId: section._id.toString(),
              lessonId: lesson._id.toString(),
            });
          } else if (quiz.questions.length === 0) {
            errors.push({
              field: 'quiz.questions',
              message: `Quiz của bài học "${lesson.title}" chưa có câu hỏi.`,
              sectionId: section._id.toString(),
              lessonId: lesson._id.toString(),
            });
          }
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  }

  public async createCourse(data: {
    title: string;
    description?: string;
    categoryId?: string;
    level?: string;
    price?: number;
    instructorId: string;
    instructorName: string;
  }): Promise<CourseResponse> {
    let resolvedCategoryId: Types.ObjectId | null = null;
    if (data.categoryId) {
      const category = await categoryService.resolveActiveCategoryById(data.categoryId);
      resolvedCategoryId = category._id as Types.ObjectId;
    }

    const course = new Course({
      ...data,
      categoryId: resolvedCategoryId,
      status: CourseStatus.DRAFT,
    });

    await course.save();

    await publishCourseCreated({
      courseId: course._id.toString(),
      title: course.title,
      instructorId: course.instructorId,
    });

    return (await this.getCourseById(course._id.toString())) as CourseResponse;
  }

  public async getMyCourses(instructorId: string): Promise<CourseResponse[]> {
    const courses = await Course.find({ instructorId })
      .populate('categoryId', 'name slug parentId')
      .sort({ createdAt: -1 })
      .lean();

    return courses.map((course) => this.mapCourseResponse(course as unknown as CourseDocumentLike, []));
  }

  public async getCourseForManage(courseId: string, instructorId: string): Promise<CourseResponse> {
    const course = await this.getOwnedCourseOrThrow(courseId, instructorId, true);
    return this.buildCourseResponse(course as unknown as CourseDocumentLike);
  }

  // File editor hiện tại chủ yếu gọi hàm này để cập nhật metadata course.
  // Curriculum item-level đã được tách sang section.service và lesson.service.
  public async updateCourse(
    courseId: string,
    instructorId: string,
    data: Partial<Pick<ICourse, 'title' | 'shortDescription' | 'description' | 'thumbnail' | 'whatYouWillLearn' | 'requirements' | 'level' | 'price'>> & { categoryId?: string }
  ): Promise<CourseResponse> {
    const course = await Course.findById(courseId);
    if (!course) throw new Error('Khóa học không tồn tại.');
    if (course.instructorId !== instructorId) throw new Error('Bạn không có quyền chỉnh sửa khóa học này.');

    if (data.title !== undefined) course.title = data.title;
    if (data.shortDescription !== undefined) course.shortDescription = data.shortDescription;
    if (data.description !== undefined) course.description = data.description;
    if (data.thumbnail !== undefined) course.thumbnail = data.thumbnail;
    if (data.whatYouWillLearn !== undefined) course.whatYouWillLearn = data.whatYouWillLearn;
    if (data.requirements !== undefined) course.requirements = data.requirements;
    if (data.categoryId !== undefined) {
      if (!data.categoryId) {
        course.categoryId = null;
      } else {
        const category = await categoryService.resolveActiveCategoryById(data.categoryId);
        course.categoryId = category._id as Types.ObjectId;
      }
    }
    if (data.level !== undefined) course.level = data.level;
    if (data.price !== undefined) course.price = data.price;

    await course.save();

    return (await this.getCourseById(course._id.toString())) as CourseResponse;
  }

  public async deleteCourse(courseId: string, instructorId: string): Promise<void> {
    const course = await Course.findById(courseId);
    if (!course) throw new Error('Khóa học không tồn tại.');
    if (course.instructorId !== instructorId) throw new Error('Bạn không có quyền xóa khóa học này.');

    const lessons = await Lesson.find({ courseId: course._id }).select('_id').lean();
    const lessonIds = lessons.map((lesson) => lesson._id);

    await Promise.all([
      lessonIds.length > 0 ? Quiz.deleteMany({ courseId: course._id, lessonId: { $in: lessonIds } }) : Promise.resolve(),
      Section.deleteMany({ courseId: course._id }),
      Lesson.deleteMany({ courseId: course._id }),
      Course.findByIdAndDelete(courseId),
    ]);
  }

  public async publishCourse(courseId: string, instructorId: string): Promise<CourseResponse> {
    const course = await Course.findById(courseId);
    if (!course) throw new Error('Khóa học không tồn tại.');
    if (course.instructorId !== instructorId) throw new Error('Bạn không có quyền publish khóa học này.');

    const validation = await this.validateCoursePublish(courseId, instructorId);
    if (!validation.ok) {
      throw new Error(validation.errors[0].message);
    }

    if (!course.categoryId) {
      throw new Error('Khóa học chưa có danh mục hợp lệ.');
    }

    await categoryService.resolveActiveCategoryById(course.categoryId.toString());

    course.status = CourseStatus.PUBLISHED;
    await course.save();

    return (await this.getCourseById(course._id.toString())) as CourseResponse;
  }

  public async getPublishedCourses(query: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    level?: string;
  }): Promise<{ courses: CourseResponse[]; total: number; page: number; totalPages: number }> {
    const page = query.page || 1;
    const limit = query.limit || 12;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { status: CourseStatus.PUBLISHED };

    if (query.search) {
      filter.$or = [
        { title: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }
    if (query.category) {
      const category = await categoryService.resolveActiveCategorySlug(query.category);
      const categoryIds = await categoryService.getDescendantAndSelfIds(category._id.toString());
      filter.categoryId = { $in: categoryIds };
    }
    if (query.level) filter.level = query.level;

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .populate('categoryId', 'name slug parentId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Course.countDocuments(filter),
    ]);

    return {
      courses: courses.map((course) => this.mapCourseResponse(course as unknown as CourseDocumentLike, [])),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  public async getCourseBySlug(slug: string): Promise<CourseResponse> {
    const course = await Course.findOne({ slug, status: CourseStatus.PUBLISHED })
      .populate('categoryId', 'name slug parentId')
      .lean();
    if (!course) throw new Error('Khóa học không tồn tại hoặc chưa được xuất bản.');
    return this.buildCourseResponse(course as unknown as CourseDocumentLike);
  }

  public async getOwnedCourseOrThrow(courseId: string, instructorId: string, populateCategory = false) {
    const query = Course.findById(courseId);
    if (populateCategory) {
      query.populate('categoryId', 'name slug parentId');
    }

    const course = await query.lean();
    if (!course) throw new Error('Khóa học không tồn tại.');
    if (course.instructorId !== instructorId) throw new Error('Bạn không có quyền truy cập khóa học này.');
    return course;
  }

  // update totalSections, totalLessons, totalDuration của course
  public async syncCourseStats(courseId: Types.ObjectId | string): Promise<void> {
    const normalizedCourseId = typeof courseId === 'string' ? new Types.ObjectId(courseId) : courseId; // dòng này để đảm bảo courseId là ObjectId
    const [sections, lessons] = await Promise.all([
      Section.find({ courseId: normalizedCourseId }).select('_id').lean(), // lấy tất cả section của course
      Lesson.find({ courseId: normalizedCourseId }).select('duration').lean(), // lấy tất cả lesson của cours
    ]);

    const totalDuration = lessons.reduce((sum, lesson) => sum + (lesson.duration || 0), 0); // tính tổng duration của course

    await Course.findByIdAndUpdate(normalizedCourseId, {
      $set: {
        totalSections: sections.length,
        totalLessons: lessons.length,
        totalDuration,
      },
    });
  }

  // Dựng response quản lý course theo shape mới: course -> sections -> lessons.
  private async getCourseById(courseId: string): Promise<CourseResponse | null> {
    const course = await Course.findById(courseId)
      .populate('categoryId', 'name slug parentId')
      .lean();

    return course ? this.buildCourseResponse(course as unknown as CourseDocumentLike) : null;
  }

  private async buildCourseResponse(course: CourseDocumentLike): Promise<CourseResponse> {
    const sections = await this.loadCourseSections(course._id.toString());
    return this.mapCourseResponse(course, sections);
  }

  // Tải toàn bộ section + lesson theo thứ tự để frontend editor render đúng curriculum.
  private async loadCourseSections(courseId: string): Promise<CourseResponse['sections']> {
    const courseObjectId = new Types.ObjectId(courseId);
    const [sections, lessons] = await Promise.all([
      Section.find({ courseId: courseObjectId }).sort({ order: 1, createdAt: 1 }).lean(),
      Lesson.find({ courseId: courseObjectId }).sort({ order: 1, createdAt: 1 }).lean(),
    ]);

    const lessonIds = lessons.map((lesson) => lesson._id);
    const quizzes = lessonIds.length > 0
      ? await Quiz.find({ courseId: courseObjectId, lessonId: { $in: lessonIds } }).select('lessonId questions').lean()
      : [];

    const quizMetaByLessonId = new Map<string, { quizId: string; questionCount: number }>();
    for (const quiz of quizzes) {
      quizMetaByLessonId.set(quiz.lessonId.toString(), {
        quizId: quiz._id.toString(),
        questionCount: quiz.questions.length,
      });
    }

    const lessonsBySectionId = new Map<string, CourseLessonResponse[]>();
    for (const lesson of lessons) {
      const sectionKey = lesson.sectionId.toString();
      const bucket = lessonsBySectionId.get(sectionKey) || [];
      const quizMeta = quizMetaByLessonId.get(lesson._id.toString());
      bucket.push({
        _id: lesson._id.toString(),
        title: lesson.title,
        type: lesson.type,
        status: lesson.status,
        summary: lesson.summary || '',
        duration: lesson.duration,
        order: lesson.order,
        isFreePreview: lesson.isFreePreview,
        videoAssetId: lesson.videoAssetId ? lesson.videoAssetId.toString() : null,
        documentAssetId: lesson.documentAssetId ? lesson.documentAssetId.toString() : null,
        quizId: quizMeta?.quizId || null,
        contentMeta: lesson.type === LessonType.QUIZ ? { questionCount: quizMeta?.questionCount || 0 } : null,
      });
      lessonsBySectionId.set(sectionKey, bucket);
    }

    return sections.map((section) => ({
      _id: section._id.toString(),
      title: section.title,
      order: section.order,
      lessons: lessonsBySectionId.get(section._id.toString()) || [],
    }));
  }

  private mapCourseResponse(course: CourseDocumentLike, sections: CourseResponse['sections']): CourseResponse {
    const category = course.categoryId && typeof course.categoryId === 'object' && 'slug' in course.categoryId
      ? {
          _id: course.categoryId._id.toString(),
          name: course.categoryId.name,
          slug: course.categoryId.slug,
          parentId: course.categoryId.parentId ? course.categoryId.parentId.toString() : null,
        }
      : null;

    return {
      _id: course._id.toString(),
      title: course.title,
      slug: course.slug,
      shortDescription: course.shortDescription || '',
      description: course.description,
      thumbnail: course.thumbnail,
      whatYouWillLearn: course.whatYouWillLearn || [],
      requirements: course.requirements || [],
      instructorId: course.instructorId,
      instructorName: course.instructorName,
      categoryId: category?._id || (course.categoryId ? course.categoryId.toString() : null),
      category,
      level: course.level,
      status: course.status,
      price: course.price,
      sections,
      totalDuration: course.totalDuration,
      totalLessons: course.totalLessons,
      totalSections: course.totalSections || 0,
      enrollmentCount: course.enrollmentCount,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}

export default new CourseService();
