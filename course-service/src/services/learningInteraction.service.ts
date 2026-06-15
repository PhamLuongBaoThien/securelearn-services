// ========================
// Learning Interaction Service
// Mục đích:
// - kiểm tra quyền trước khi đọc/ghi ghi chú và thảo luận bài học
// - cung cấp dữ liệu tương tác thật cho màn học
// ========================
import { Types } from 'mongoose';
import { Course } from '../models/course.model';
import { Lesson } from '../models/lesson.model';
import { LearningNote } from '../models/learningNote.model';
import { LessonDiscussion } from '../models/lessonDiscussion.model';
import subscriptionAccessService from './subscriptionAccess.service';

class LearningInteractionService {
  private async assertAccess(userId: string, userRole: string, courseId: string, lessonId: string) {
    const course = await Course.findById(courseId).select('_id instructorId currentVersionId').lean();
    if (!course?.currentVersionId) throw new Error('Khóa học không tồn tại.');

    const lesson = await Lesson.findOne({
      _id: lessonId,
      courseId: course.currentVersionId,
    }).select('_id').lean();
    if (!lesson) throw new Error('Bài học không thuộc khóa học này.');

    const isOwner = userRole === 'INSTRUCTOR' && course.instructorId === userId;
    if (!isOwner) {
      const access = await subscriptionAccessService.entitlement(userId, courseId);
      if (!access.allowed) throw new Error('Bạn không có quyền truy cập khóa học này.');
    }

    return {
      courseId: new Types.ObjectId(course._id),
      lessonId: new Types.ObjectId(lesson._id),
      isOwner,
    };
  }

  public async getNote(userId: string, userRole: string, courseId: string, lessonId: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    return LearningNote.findOne({ userId, courseId: access.courseId, lessonId: access.lessonId }).lean();
  }

  public async saveNote(
    userId: string,
    userRole: string,
    courseId: string,
    lessonId: string,
    content: string,
    timestampSec: number,
  ) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    return LearningNote.findOneAndUpdate(
      { userId, courseId: access.courseId, lessonId: access.lessonId },
      {
        $set: {
          content: content.slice(0, 10_000),
          timestampSec: Math.max(0, Math.floor(timestampSec || 0)),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }

  public async listDiscussions(userId: string, userRole: string, courseId: string, lessonId: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    return LessonDiscussion.find({ courseId: access.courseId, lessonId: access.lessonId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
  }

  public async createDiscussion(
    user: { id: string; role: string; name: string },
    courseId: string,
    lessonId: string,
    content: string,
    timestampSec: number,
  ) {
    const access = await this.assertAccess(user.id, user.role, courseId, lessonId);
    const normalizedContent = content.trim();
    if (!normalizedContent) throw new Error('Vui lòng nhập nội dung thảo luận.');

    return LessonDiscussion.create({
      courseId: access.courseId,
      lessonId: access.lessonId,
      authorId: user.id,
      authorName: user.name || (access.isOwner ? 'Giảng viên' : 'Học viên'),
      authorRole: access.isOwner ? 'INSTRUCTOR' : 'STUDENT',
      content: normalizedContent,
      timestampSec: Math.max(0, Math.floor(timestampSec || 0)),
    });
  }
}

export default new LearningInteractionService();
