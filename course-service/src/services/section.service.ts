// File này chứa nghiệp vụ CRUD và reorder cho Section.
// Ghi nhớ:
// - section thuộc course
// - xóa section sẽ xóa luôn toàn bộ lesson trong section đó
// - sau khi xóa cần resequence order và sync lại course stats
import { Types } from 'mongoose';
import { CourseVersion } from '../models/courseVersion.model';
import { Lesson } from '../models/lesson.model';
import { Section } from '../models/section.model';
import { Quiz } from '../models/quiz.model';
import courseService from './course.service';
import mediaReferenceService from './mediaReference.service';

class SectionService {
  // Tạo section mới theo thứ tự trong course.
  public async createSection(courseId: string, instructorId: string, data: { title: string; order?: number }) {
    const course = await this.assertCourseOwnership(courseId, instructorId);
    const title = data.title?.trim();
    if (!title) throw new Error('Vui lòng nhập tên chương.');

    const order = data.order ?? (await Section.countDocuments({ courseId: course._id })) + 1;
    const existing = await Section.findOne({ courseId: course._id, order });
    if (existing) {
      throw new Error('Thứ tự chương đã tồn tại. Vui lòng sắp xếp lại trước khi thêm mới.');
    }

    const section = await Section.create({
      courseId: course._id,
      title,
      order,
    });

    await courseService.syncCourseStats(course._id);
    return section;
  }

  public async updateSection(courseId: string, sectionId: string, instructorId: string, data: { title?: string }) {
    await this.assertCourseOwnership(courseId, instructorId);
    const section = await Section.findOne({ _id: sectionId, courseId });
    if (!section) throw new Error('Chương không tồn tại.');

    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) throw new Error('Tên chương không được để trống.');
      section.title = title;
    }

    await section.save();
    return section;
  }

  public async deleteSection(courseId: string, sectionId: string, instructorId: string): Promise<void> {
    await this.assertCourseOwnership(courseId, instructorId);
    const section = await Section.findOne({ _id: sectionId, courseId });
    if (!section) throw new Error('Chương không tồn tại.');

    // Load đầy đủ asset fields để phát cleanup events
    const lessons = await Lesson.find({ sectionId: section._id })
      .select('_id courseId videoAssetId attachments')
      .lean();
    const lessonIds = lessons.map(lesson => lesson._id);

    await mediaReferenceService.cleanupMediaForRemovedLessons(lessons);

    if (lessonIds.length > 0) {
      await Quiz.deleteMany({ lessonId: { $in: lessonIds }, courseId });
    }

    await Promise.all([
      Lesson.deleteMany({ sectionId: section._id }),
      Section.deleteOne({ _id: section._id }),
    ]);

    await this.resequenceSections(courseId);
    await courseService.syncCourseStats(courseId);
  }

  // Reorder nhận danh sách order từ client, không tự normalize nếu payload bị lệch.
  public async reorderSections(
    courseId: string,
    instructorId: string,
    items: Array<{ sectionId: string; order: number }>
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Danh sách sắp xếp chương không hợp lệ.');
    }

    await this.assertCourseOwnership(courseId, instructorId);
    const sectionIds = items.map((item) => item.sectionId);
    const sections = await Section.find({ courseId, _id: { $in: sectionIds } }).select('_id').lean();
    if (sections.length !== items.length) {
      throw new Error('Có chương không tồn tại hoặc không thuộc khóa học này.');
    }

    const uniqueOrders = new Set(items.map((item) => item.order));
    if (uniqueOrders.size !== items.length) {
      throw new Error('Thứ tự chương bị trùng.');
    }

    // Để tránh lỗi E11000 duplicate key do unique index (courseId, order) khi swap thứ tự
    // Bước 1: Set các order về số âm tạm thời
    const tempOps = items.map((item) => ({
      updateOne: {
        filter: { _id: item.sectionId, courseId },
        update: { $set: { order: -item.order } },
      },
    }));
    await Section.bulkWrite(tempOps);

    // Bước 2: Set lại order về số dương chuẩn
    const finalOps = items.map((item) => ({
      updateOne: {
        filter: { _id: item.sectionId, courseId },
        update: { $set: { order: item.order } },
      },
    }));
    await Section.bulkWrite(finalOps);
  }

  private async assertCourseOwnership(courseId: string, instructorId: string) {
    const version = await CourseVersion.findById(courseId);
    if (!version) throw new Error('Bản nội dung khóa học không tồn tại.');
    if (version.instructorId !== instructorId) throw new Error('Bạn không có quyền truy cập khóa học này.');
    courseService.assertCourseEditable(version.status);
    return version;
  }

  private async resequenceSections(courseId: string): Promise<void> {
    const sections = await Section.find({ courseId }).sort({ order: 1, createdAt: 1 });
    if (sections.length === 0) return;

    const tempOps = sections.map((section, index) => ({
      updateOne: {
        filter: { _id: section._id, courseId },
        update: { $set: { order: -(sections.length + index + 1) } },
      },
    }));
    await Section.bulkWrite(tempOps);

    const finalOps = sections.map((section, index) => ({
      updateOne: {
        filter: { _id: section._id, courseId },
        update: { $set: { order: index + 1 } },
      },
    }));
    await Section.bulkWrite(finalOps);
  }
}

export default new SectionService();
