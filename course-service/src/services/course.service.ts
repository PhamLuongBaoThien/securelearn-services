// ========================
// Service Layer: Logic nghiệp vụ Khóa học
// ========================
import { Course, ICourse, CourseStatus } from '../models/course.model';
import { publishCourseCreated } from '../events/publishers';
import categoryService from './category.service';
import { Types } from 'mongoose';

interface CourseResponse {
  _id: string;
  title: string;
  slug: string;
  description: string;
  thumbnail: string;
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
  sections: any[];
  totalDuration: number;
  totalLessons: number;
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

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

    // Publish event
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
      .select('-sections') // Không trả sections trong list view
      .sort({ createdAt: -1 })
      .lean();

    return courses.map((course) => this.mapCourseResponse(course));
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
    return this.mapCourseResponse(course);
  }

  /**
   * Cập nhật khóa học (chỉ owner).
   */
  public async updateCourse(
    courseId: string,
    instructorId: string,
    data: Partial<Pick<ICourse, 'title' | 'description' | 'thumbnail' | 'level' | 'price' | 'sections'>> & { categoryId?: string }
  ): Promise<CourseResponse> {
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.instructorId !== instructorId) {
      throw new Error('Bạn không có quyền chỉnh sửa khóa học này.');
    }

    // Cập nhật các trường được truyền vào
    if (data.title !== undefined) course.title = data.title;
    if (data.description !== undefined) course.description = data.description;
    if (data.thumbnail !== undefined) course.thumbnail = data.thumbnail;
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
    if (data.sections !== undefined) course.sections = data.sections;

    await course.save(); // Pre-save hook tự tính totalDuration, totalLessons
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

    await Course.findByIdAndDelete(courseId);
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
    if (course.sections.length === 0) {
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

    // Build filter
    const filter: any = { status: CourseStatus.PUBLISHED };

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
        .select('-sections') // Không trả sections trong list view
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Course.countDocuments(filter),
    ]);

    return {
      courses: courses.map((course) => this.mapCourseResponse(course)),
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
    return this.mapCourseResponse(course);
  }

  private async getCourseById(courseId: string): Promise<CourseResponse | null> {
    const course = await Course.findById(courseId)
      .populate('categoryId', 'name slug parentId')
      .lean();

    return course ? this.mapCourseResponse(course) : null;
  }

  private mapCourseResponse(course: any): CourseResponse {
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
      description: course.description,
      thumbnail: course.thumbnail,
      instructorId: course.instructorId,
      instructorName: course.instructorName,
      categoryId: category?._id || (course.categoryId ? course.categoryId.toString() : null),
      category,
      level: course.level,
      status: course.status,
      price: course.price,
      sections: course.sections || [],
      totalDuration: course.totalDuration,
      totalLessons: course.totalLessons,
      enrollmentCount: course.enrollmentCount,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}

export default new CourseService();
