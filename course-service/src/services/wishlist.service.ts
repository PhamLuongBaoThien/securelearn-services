import { Types } from 'mongoose';
import { Wishlist } from '../models/wishlist.model';
import { Course, CourseStatus, ICourse } from '../models/course.model';

export interface WishlistCourseItem {
  _id: string;
  slug: string;
  title: string;
  price: number;
  thumbnail?: string;
  instructorName: string;
  instructorId: string;
  addedAt: Date;
  level?: string;
  totalLessons?: number;
  totalDuration?: number;
  rating?: number;
}

export interface WishlistResponse {
  items: WishlistCourseItem[];
}

class WishlistService {
  public async getWishlist(userId: string): Promise<WishlistResponse> {
    const wishlist = await Wishlist.findOne({ userId }).lean();
    if (!wishlist || wishlist.items.length === 0) {
      return { items: [] };
    }

    return this.hydrateItems(wishlist.items);
  }

  public async addItem(userId: string, courseId: string, userRole?: string): Promise<WishlistResponse> {
    const course = await this.getPublishedCourseOrThrow(courseId);
    this.assertCanSaveCourse(course, userId, userRole);

    await Wishlist.updateOne(
      { userId, 'items.courseId': { $ne: course._id } },
      { $push: { items: { courseId: course._id, addedAt: new Date() } } },
      { upsert: true }
    );

    return this.getWishlist(userId);
  }

  public async removeItem(userId: string, courseId: string): Promise<WishlistResponse> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new Error('Khóa học không hợp lệ.');
    }

    await Wishlist.updateOne(
      { userId },
      { $pull: { items: { courseId: new Types.ObjectId(courseId) } } }
    );

    return this.getWishlist(userId);
  }

  public async mergeGuestWishlist(userId: string, courseIds: string[], userRole?: string): Promise<WishlistResponse> {
    const uniqueIds = [...new Set(courseIds.filter((courseId) => Types.ObjectId.isValid(courseId)))];
    if (uniqueIds.length === 0) {
      return this.getWishlist(userId);
    }

    const objectIds = uniqueIds.map((courseId) => new Types.ObjectId(courseId));
    const courses = await Course.find({
      _id: { $in: objectIds },
      status: CourseStatus.PUBLISHED,
    }).select('_id instructorId').lean();

    const allowedCourseIds = courses
      .filter((course) => !(userRole === 'INSTRUCTOR' && course.instructorId.toString() === userId))
      .map((course) => course._id as Types.ObjectId);

    if (allowedCourseIds.length === 0) {
      return this.getWishlist(userId);
    }

    const wishlist = await Wishlist.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true }
    );

    const existingIds = new Set(wishlist.items.map((item) => item.courseId.toString()));
    allowedCourseIds.forEach((courseId) => {
      if (!existingIds.has(courseId.toString())) {
        wishlist.items.push({ courseId, addedAt: new Date() });
      }
    });

    await wishlist.save();
    return this.getWishlist(userId);
  }

  public async clearWishlist(userId: string): Promise<WishlistResponse> {
    await Wishlist.updateOne({ userId }, { $set: { items: [] } });
    return { items: [] };
  }

  private async getPublishedCourseOrThrow(courseId: string): Promise<ICourse> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new Error('Khóa học không hợp lệ.');
    }

    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error('Khóa học không tồn tại.');
    }
    if (course.status !== CourseStatus.PUBLISHED) {
      throw new Error('Khóa học chưa được xuất bản.');
    }

    return course;
  }

  private assertCanSaveCourse(course: ICourse, userId: string, userRole?: string): void {
    if (userRole === 'INSTRUCTOR' && course.instructorId.toString() === userId) {
      throw new Error('Giảng viên không thể lưu khóa học do chính mình tạo vào danh sách mong muốn.');
    }
  }

  private async hydrateItems(items: Array<{ courseId: Types.ObjectId; addedAt: Date }>): Promise<WishlistResponse> {
    const courseIds = items.map((item) => item.courseId);
    const courses = await Course.find({
      _id: { $in: courseIds },
      status: CourseStatus.PUBLISHED,
    })
      .select('slug title price thumbnail instructorName instructorId level totalLessons totalDuration ratingAverage')
      .lean();

    const coursesById = new Map(courses.map((course) => [course._id.toString(), course]));
    const hydratedItems = items.reduce<WishlistCourseItem[]>((result, item) => {
      const course = coursesById.get(item.courseId.toString());
      if (!course) return result;
      result.push({
        _id: course._id.toString(),
        slug: course.slug,
        title: course.title,
        price: course.price,
        thumbnail: course.thumbnail,
        instructorName: course.instructorName,
        instructorId: course.instructorId,
        addedAt: item.addedAt,
        level: course.level,
        totalLessons: course.totalLessons,
        totalDuration: course.totalDuration,
        rating: course.ratingAverage,
      });
      return result;
    }, []);

    return { items: hydratedItems };
  }
}

export default new WishlistService();
