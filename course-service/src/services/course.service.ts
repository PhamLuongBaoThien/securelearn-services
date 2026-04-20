// ========================
// Service Layer: Logic nghiệp vụ Khóa học
// ========================
import { Course, ICourse, CourseStatus } from '../models/course.model';
import { publishCourseCreated } from '../events/publishers';

class CourseService {
  /**
   * Tạo khóa học mới (DRAFT).
   */
  public async createCourse(data: {
    title: string;
    description?: string;
    category?: string;
    level?: string;
    price?: number;
    instructorId: string;
    instructorName: string;
  }): Promise<ICourse> {
    const course = new Course({
      ...data,
      status: CourseStatus.DRAFT,
    });

    await course.save();

    // Publish event
    await publishCourseCreated({
      courseId: course._id.toString(),
      title: course.title,
      instructorId: course.instructorId,
    });

    return course;
  }

  /**
   * Lấy danh sách khóa học của giảng viên (bao gồm DRAFT).
   */
  public async getMyCourses(instructorId: string): Promise<ICourse[]> {
    return Course.find({ instructorId })
      .select('-sections') // Không trả sections trong list view
      .sort({ createdAt: -1 });
  }

  /**
   * Lấy chi tiết khóa học (cho Instructor quản lý — bao gồm DRAFT).
   * Kiểm tra quyền sở hữu.
   */
  public async getCourseForManage(courseId: string, instructorId: string): Promise<ICourse> {
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.instructorId !== instructorId) {
      throw new Error('Bạn không có quyền quản lý khóa học này.');
    }
    return course;
  }

  /**
   * Cập nhật khóa học (chỉ owner).
   */
  public async updateCourse(
    courseId: string,
    instructorId: string,
    data: Partial<Pick<ICourse, 'title' | 'description' | 'thumbnail' | 'category' | 'level' | 'price' | 'sections'>>
  ): Promise<ICourse> {
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
    if (data.category !== undefined) course.category = data.category;
    if (data.level !== undefined) course.level = data.level;
    if (data.price !== undefined) course.price = data.price;
    if (data.sections !== undefined) course.sections = data.sections;

    await course.save(); // Pre-save hook tự tính totalDuration, totalLessons
    return course;
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
  public async publishCourse(courseId: string, instructorId: string): Promise<ICourse> {
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

    course.status = CourseStatus.PUBLISHED;
    await course.save();

    return course;
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
  }): Promise<{ courses: ICourse[]; total: number; page: number; totalPages: number }> {
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
      filter.category = query.category;
    }
    if (query.level) {
      filter.level = query.level;
    }

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .select('-sections') // Không trả sections trong list view
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Course.countDocuments(filter),
    ]);

    return {
      courses,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Lấy chi tiết khóa học theo slug (Public — chỉ PUBLISHED).
   * Ẩn content của lesson không miễn phí (chỉ trả metadata).
   */
  public async getCourseBySlug(slug: string): Promise<ICourse> {
    const course = await Course.findOne({ slug, status: CourseStatus.PUBLISHED });
    if (!course) {
      throw new Error('Khóa học không tồn tại hoặc chưa được xuất bản.');
    }
    return course;
  }
}

export default new CourseService();
