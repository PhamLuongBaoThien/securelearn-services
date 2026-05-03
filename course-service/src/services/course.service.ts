// ========================
// Service Layer: Logic nghiệp vụ Khóa học
// ========================
import { Types } from 'mongoose';
import { Course, ICourse, CourseStatus } from '../models/course.model';
import { Lesson, LessonType } from '../models/lesson.model';
import { Section } from '../models/section.model';
import { publishCourseCreated } from '../events/publishers';
import categoryService from './category.service';

interface LessonInput {
  title: string;
  type?: string;
  content?: string;
  duration?: number;
  order?: number;
  isFreePreview?: boolean;
}

interface SectionInput {
  title: string;
  order?: number;
  lessons?: LessonInput[];
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
    lessons: Array<{
      _id: string;
      title: string;
      type: string;
      content: string;
      duration: number;
      order: number;
      isFreePreview: boolean;
    }>;
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
  /**
   * Tạo khóa học mới (DRAFT).
   */
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

    return this.getCourseById(course._id.toString()) as Promise<CourseResponse>;
  }

  /**
   * Lấy danh sách khóa học của giảng viên (bao gồm DRAFT).
   */
  public async getMyCourses(instructorId: string): Promise<CourseResponse[]> {
    const courses = await Course.find({ instructorId })
      .populate('categoryId', 'name slug parentId')
      .sort({ createdAt: -1 })
      .lean();

    return courses.map((course) => this.mapCourseResponse(course as unknown as CourseDocumentLike, []));
  }

  /**
   * Lấy chi tiết khóa học (cho Instructor quản lý — bao gồm DRAFT).
   * Kiểm tra quyền sở hữu.
   */
  public async getCourseForManage(courseId: string, instructorId: string): Promise<CourseResponse> {
    const course = await Course.findById(courseId)
      .populate('categoryId', 'name slug parentId')
      .lean();
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.instructorId !== instructorId) {
      throw new Error('Bạn không có quyền quản lý khóa học này.');
    }

    return this.buildCourseResponse(course as unknown as CourseDocumentLike);
  }

  /**
   * Cập nhật khóa học (chỉ owner).
   */
  public async updateCourse(
    courseId: string,
    instructorId: string,
    data: Partial<Pick<ICourse, 'title' | 'shortDescription' | 'description' | 'thumbnail' | 'whatYouWillLearn' | 'requirements' | 'level' | 'price'>> & { categoryId?: string; sections?: SectionInput[] }
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

    if (data.sections !== undefined) {
      await this.replaceCurriculum(course._id as Types.ObjectId, data.sections);
    }

    return this.getCourseById(course._id.toString()) as Promise<CourseResponse>;
  }

  /**
   * Xóa khóa học (chỉ owner).
   */
  public async deleteCourse(courseId: string, instructorId: string): Promise<void> {
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.instructorId !== instructorId) {
      throw new Error('Bạn không có quyền xóa khóa học này.');
    }

    await Promise.all([
      Section.deleteMany({ courseId: course._id }),
      Lesson.deleteMany({ courseId: course._id }),
      Course.findByIdAndDelete(courseId),
    ]);
  }

  /**
   * Publish khóa học (chuyển DRAFT → PUBLISHED).
   */
  public async publishCourse(courseId: string, instructorId: string): Promise<CourseResponse> {
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.instructorId !== instructorId) {
      throw new Error('Bạn không có quyền publish khóa học này.');
    }

    const sectionCount = await Section.countDocuments({ courseId: course._id });
    if (sectionCount === 0) {
      throw new Error('Khóa học phải có ít nhất 1 chương trước khi publish.');
    }
    if (!course.categoryId) {
      throw new Error('Khóa học phải có danh mục trước khi publish.');
    }

    await categoryService.resolveActiveCategoryById(course.categoryId.toString());

    course.status = CourseStatus.PUBLISHED;
    await course.save();

    return this.getCourseById(course._id.toString()) as Promise<CourseResponse>;
  }

  /**
   * Lấy danh sách khóa học đã PUBLISHED (Public — có search, filter, phân trang).
   */
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
    if (query.level) {
      filter.level = query.level;
    }

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

  /**
   * Lấy chi tiết khóa học theo slug (Public — chỉ PUBLISHED).
   * Ẩn content của lesson không miễn phí (chỉ trả metadata).
   */
  public async getCourseBySlug(slug: string): Promise<CourseResponse> {
    const course = await Course.findOne({ slug, status: CourseStatus.PUBLISHED })
      .populate('categoryId', 'name slug parentId')
      .lean();
    if (!course) {
      throw new Error('Khóa học không tồn tại hoặc chưa được xuất bản.');
    }

    return this.buildCourseResponse(course as unknown as CourseDocumentLike);
  }

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

  private async loadCourseSections(courseId: string): Promise<CourseResponse['sections']> {
    const courseObjectId = new Types.ObjectId(courseId);
    const [sections, lessons] = await Promise.all([
      Section.find({ courseId: courseObjectId }).sort({ order: 1, createdAt: 1 }).lean(),
      Lesson.find({ courseId: courseObjectId }).sort({ order: 1, createdAt: 1 }).lean(),
    ]);

    const lessonsBySectionId = new Map<string, CourseResponse['sections'][number]['lessons']>();
    for (const lesson of lessons) {
      const sectionKey = lesson.sectionId.toString();
      const bucket = lessonsBySectionId.get(sectionKey) || [];
      bucket.push({
        _id: lesson._id.toString(),
        title: lesson.title,
        type: lesson.type,
        content: lesson.content,
        duration: lesson.duration,
        order: lesson.order,
        isFreePreview: lesson.isFreePreview,
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

  private async replaceCurriculum(courseId: Types.ObjectId, sections: SectionInput[]): Promise<void> {
    const normalizedSections = sections.map((section, sectionIndex) => ({
      title: section.title?.trim() || `Section ${sectionIndex + 1}`,
      order: section.order ?? sectionIndex + 1,
      lessons: (section.lessons || []).map((lesson, lessonIndex) => ({
        title: lesson.title?.trim() || `Lesson ${lessonIndex + 1}`,
        type: this.normalizeLessonType(lesson.type),
        content: lesson.content || '',
        duration: typeof lesson.duration === 'number' ? lesson.duration : 0,
        order: lesson.order ?? lessonIndex + 1,
        isFreePreview: Boolean(lesson.isFreePreview),
      })),
    }));

    await Promise.all([
      Lesson.deleteMany({ courseId }),
      Section.deleteMany({ courseId }),
    ]);

    const createdSections = await Section.insertMany(
      normalizedSections.map((section) => ({
        courseId,
        title: section.title,
        order: section.order,
      }))
    );

    const lessonsToInsert = createdSections.flatMap((section, index) =>
      normalizedSections[index].lessons.map((lesson) => ({
        courseId,
        sectionId: section._id,
        title: lesson.title,
        type: lesson.type,
        content: lesson.content,
        duration: lesson.duration,
        order: lesson.order,
        isFreePreview: lesson.isFreePreview,
      }))
    );

    if (lessonsToInsert.length > 0) {
      await Lesson.insertMany(lessonsToInsert);
    }

    const totals = normalizedSections.reduce(
      (acc, section) => {
        acc.totalSections += 1;
        acc.totalLessons += section.lessons.length;
        acc.totalDuration += section.lessons.reduce((sum, lesson) => sum + lesson.duration, 0);
        return acc;
      },
      { totalSections: 0, totalLessons: 0, totalDuration: 0 }
    );

    await Course.findByIdAndUpdate(courseId, {
      $set: {
        totalSections: totals.totalSections,
        totalLessons: totals.totalLessons,
        totalDuration: totals.totalDuration,
      },
    });
  }

  private normalizeLessonType(type?: string): LessonType {
    if (!type) return LessonType.VIDEO;
    return Object.values(LessonType).includes(type as LessonType) ? (type as LessonType) : LessonType.VIDEO;
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
