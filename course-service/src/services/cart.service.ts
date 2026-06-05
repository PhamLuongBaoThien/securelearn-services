import { Types } from 'mongoose';
import { Cart } from '../models/cart.model';
import { Course, CourseStatus, ICourse } from '../models/course.model';

export interface CartCourseItem {
  _id: string;
  slug: string;
  title: string;
  price: number;
  thumbnail?: string;
  instructorName: string;
  addedAt: Date;
}

export interface CartResponse {
  items: CartCourseItem[];
  totalPrice: number;
}

class CartService {
  public async getCart(userId: string): Promise<CartResponse> {
    const cart = await Cart.findOne({ userId }).lean();
    if (!cart || cart.items.length === 0) {
      return { items: [], totalPrice: 0 };
    }

    return this.hydrateItems(cart.items);
  }

  public async addItem(userId: string, courseId: string, userRole?: string): Promise<CartResponse> {
    const course = await this.getPublishedCourseOrThrow(courseId);
    this.assertCanAddCourse(course, userId, userRole);

    await Cart.updateOne(
      { userId, 'items.courseId': { $ne: course._id } },
      { $push: { items: { courseId: course._id, addedAt: new Date() } } },
      { upsert: true }
    );

    return this.getCart(userId);
  }

  public async removeItem(userId: string, courseId: string): Promise<CartResponse> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new Error('Khóa học không hợp lệ.');
    }

    await Cart.updateOne(
      { userId },
      { $pull: { items: { courseId: new Types.ObjectId(courseId) } } }
    );

    return this.getCart(userId);
  }

  public async mergeGuestCart(userId: string, courseIds: string[], userRole?: string): Promise<CartResponse> {
    const uniqueIds = [...new Set(courseIds.filter((courseId) => Types.ObjectId.isValid(courseId)))];
    if (uniqueIds.length === 0) {
      return this.getCart(userId);
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
      return this.getCart(userId);
    }

    const cart = await Cart.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true }
    );

    const existingIds = new Set(cart.items.map((item) => item.courseId.toString()));
    allowedCourseIds.forEach((courseId) => {
      if (!existingIds.has(courseId.toString())) {
        cart.items.push({ courseId, addedAt: new Date() });
      }
    });

    await cart.save();
    return this.getCart(userId);
  }

  public async clearCart(userId: string): Promise<CartResponse> {
    await Cart.updateOne({ userId }, { $set: { items: [] } });
    return { items: [], totalPrice: 0 };
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

  private assertCanAddCourse(course: ICourse, userId: string, userRole?: string): void {
    if (userRole === 'INSTRUCTOR' && course.instructorId.toString() === userId) {
      throw new Error('Giảng viên không thể thêm khóa học do chính mình tạo vào giỏ hàng.');
    }
  }

  private async hydrateItems(items: Array<{ courseId: Types.ObjectId; addedAt: Date }>): Promise<CartResponse> {
    const courseIds = items.map((item) => item.courseId);
    const courses = await Course.find({
      _id: { $in: courseIds },
      status: CourseStatus.PUBLISHED,
    })
      .select('slug title price thumbnail instructorName')
      .lean();

    const coursesById = new Map(courses.map((course) => [course._id.toString(), course]));
    const hydratedItems = items.reduce<CartCourseItem[]>((result, item) => {
        const course = coursesById.get(item.courseId.toString());
        if (!course) return result;
        result.push({
          _id: course._id.toString(),
          slug: course.slug,
          title: course.title,
          price: course.price,
          thumbnail: course.thumbnail,
          instructorName: course.instructorName,
          addedAt: item.addedAt,
        });
        return result;
      }, []);

    return {
      items: hydratedItems,
      totalPrice: hydratedItems.reduce((sum, item) => sum + item.price, 0),
    };
  }
}

export default new CartService();
