// File này chứa nghiệp vụ chính cho Lesson.
// Ghi nhớ:
// - lesson hỗ trợ 2 type: VIDEO, QUIZ
// - tài liệu đính kèm (attachments) dùng chung cho cả 2 type, không phụ thuộc vào type
// - lesson.status đi qua DRAFT -> PROCESSING/READY/FAILED tùy loại nội dung
// - đổi lesson.type phải cleanup reference cũ (video/quiz) để tránh dữ liệu mồ côi
// - attachments không bị xóa khi đổi type
import { Types } from 'mongoose';
import { CourseVersion } from '../models/courseVersion.model';
import { ILesson, Lesson, LessonStatus, LessonType } from '../models/lesson.model';
import { Quiz } from '../models/quiz.model';
import { Section } from '../models/section.model';
import courseService from './course.service';
import {
  publishVideoAssetAttached,
  publishDocumentAssetAttached,
} from '../events/publishers';
import mediaReferenceService from './mediaReference.service';
import { mediaGrpcClient } from '../grpc/media.client';

interface MediaAssetBindingSnapshot {
  assetId: string;
  ownerUserId: string;
  courseId: string;
  lessonId: string;
}

class LessonService {
  // Lesson mới mặc định là VIDEO và status DRAFT cho tới khi được bind nội dung hợp lệ.
  public async createLesson(
    courseId: string,
    sectionId: string,
    instructorId: string,
    data: {
      title: string;
      type?: LessonType;
      content?: string;
      order?: number;
      duration?: number;
      isFreePreview?: boolean;
    }
  ) {
    const { course, section } = await this.assertCourseAndSectionOwnership(courseId, sectionId, instructorId);
    // Kiểm tra tên bài học
    const title = data.title?.trim();
    if (!title) throw new Error('Vui lòng nhập tên bài học.');

    // Kiểm tra thứ tự bài học
    const order = data.order ?? (await Lesson.countDocuments({ sectionId: section._id })) + 1;
    const existing = await Lesson.findOne({ sectionId: section._id, order });
    if (existing) {
      throw new Error('Thứ tự bài học đã tồn tại trong chương này.');
    }

    const lessonType = this.normalizeLessonType(data.type);
    const lesson = await Lesson.create({
      courseId: course._id,
      sectionId: section._id,
      title,
      type: lessonType,
      status: LessonStatus.DRAFT,
      content: data.content || '',
      duration: data.duration ?? 0,
      order,
      isFreePreview: Boolean(data.isFreePreview),
      videoAssetId: null,
      attachments: [],
    });

    await courseService.syncCourseStats(course._id);
    return lesson;
  }

  // Nếu đổi type, hệ thống sẽ reset video/quiz cũ và đưa lesson về DRAFT.
  // Attachments được GIỮ NGUYÊN khi đổi type.
  public async updateLesson(
    courseId: string,
    lessonId: string,
    instructorId: string,
    data: {
      title?: string;
      type?: LessonType;
      content?: string;
      duration?: number;
      isFreePreview?: boolean;
      status?: LessonStatus;
    }
  ) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');

    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) throw new Error('Tên bài học không được để trống.');
      lesson.title = title;
    }

    if (data.content !== undefined) lesson.content = data.content;
    if (data.duration !== undefined) lesson.duration = data.duration;
    if (data.isFreePreview !== undefined) lesson.isFreePreview = Boolean(data.isFreePreview);

    if (data.type !== undefined && data.type !== lesson.type) {
      await this.cleanupLessonMediaForTypeChange(lesson); // clear video/quiz cũ nếu đổi type
      lesson.type = this.normalizeLessonType(data.type);
      lesson.status = LessonStatus.DRAFT;
    } else if (data.status !== undefined) {
      lesson.status = this.normalizeLessonStatus(data.status);
    }

    await lesson.save();
    await courseService.syncCourseStats(courseId);
    return lesson;
  }

  // Khi xóa lesson: dọn quiz + video + toàn bộ attachments trước khi xoá DB.
  public async deleteLesson(courseId: string, lessonId: string, instructorId: string): Promise<void> {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');

    // Phát cleanup event cho video asset
    if (lesson.videoAssetId) {
      await mediaReferenceService.cleanupVideoIfUnused(lesson.videoAssetId, {
        courseId,
        lessonId,
      });
    }

    // Phát cleanup event cho toàn bộ attachments
    for (const attachmentId of lesson.attachments) {
      await mediaReferenceService.cleanupDocumentIfUnused(attachmentId, {
        courseId,
        lessonId,
      });
    }

    await Quiz.deleteOne({ lessonId: lesson._id, courseId });
    await Lesson.deleteOne({ _id: lesson._id });
    await this.resequenceLessons(courseId, lesson.sectionId.toString());
    await courseService.syncCourseStats(courseId);
  }

  // di chuyển bài học và sắp xếp lại thứ tự bài học
  public async reorderLessons(
    courseId: string,
    sectionId: string,
    instructorId: string,
    items: Array<{ lessonId: string; order: number }>
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Danh sách sắp xếp bài học không hợp lệ.');
    }

    await this.assertCourseAndSectionOwnership(courseId, sectionId, instructorId);
    const lessonIds = items.map((item) => item.lessonId);
    const lessons = await Lesson.find({ courseId, sectionId, _id: { $in: lessonIds } }).select('_id').lean();
    if (lessons.length !== items.length) {
      throw new Error('Có bài học không tồn tại hoặc không thuộc chương này.');
    }

    const uniqueOrders = new Set(items.map((item) => item.order));
    if (uniqueOrders.size !== items.length) {
      throw new Error('Thứ tự bài học bị trùng.');
    }

    // Để tránh lỗi E11000 duplicate key do unique index (sectionId, order) khi swap thứ tự
    // Bước 1: Set các order về số âm tạm thời
    const tempOps = items.map((item) => ({
      updateOne: {
        filter: { _id: item.lessonId, courseId, sectionId },
        update: { $set: { order: -item.order } },
      },
    }));
    await Lesson.bulkWrite(tempOps);

    // Bước 2: Set lại order về số dương chuẩn
    const finalOps = items.map((item) => ({
      updateOne: {
        filter: { _id: item.lessonId, courseId, sectionId },
        update: { $set: { order: item.order } },
      },
    }));
    await Lesson.bulkWrite(finalOps);
  }

  // Video được bind trước, nhưng chỉ READY sau khi media-service xử lý xong và bắn event về.
  public async bindVideoAsset(
    courseId: string,
    lessonId: string,
    instructorId: string,
    videoAssetId: string,
  ) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.VIDEO) throw new Error('Chỉ bài học video mới được gắn video asset.');
    await this.assertVideoAssetBinding(videoAssetId, courseId, lessonId, instructorId);

    const previousVideoAssetId = lesson.videoAssetId?.toString() || null; // Lưu lại videoAssetId cũ để nếu có đổi video thì sẽ phát event cleanup cho video cũ

    lesson.videoAssetId = new Types.ObjectId(videoAssetId); //Types.ObjectId là để convert string sang ObjectId, vì videoAssetId trong lesson là kiểu ObjectId
    lesson.status = LessonStatus.PROCESSING;
    await Quiz.deleteOne({ lessonId: lesson._id, courseId });
    await lesson.save();

    await publishVideoAssetAttached({
      assetId: videoAssetId,
      courseId,
      lessonId,
    });

    if (previousVideoAssetId && previousVideoAssetId !== videoAssetId) {
      await mediaReferenceService.cleanupVideoIfUnused(previousVideoAssetId, {
        courseId,
        lessonId,
      });
    }

    return lesson;
  }

  public async unbindVideoAsset(courseId: string, lessonId: string, instructorId: string) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.VIDEO) throw new Error('Chỉ bài học video mới được gỡ video asset.');

    if (lesson.videoAssetId) {
      await mediaReferenceService.cleanupVideoIfUnused(lesson.videoAssetId, {
        courseId,
        lessonId,
      });
    }

    lesson.videoAssetId = null;
    lesson.status = LessonStatus.DRAFT;
    lesson.duration = 0;
    await lesson.save();

    await courseService.syncCourseStats(courseId);
    return lesson;
  }

  // Quiz bind xong sẽ đưa lesson sang READY.
  public async bindQuiz(courseId: string, lessonId: string, instructorId: string) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.QUIZ) throw new Error('Chỉ bài học quiz mới được gắn quiz.');

    lesson.videoAssetId = null;
    lesson.status = LessonStatus.READY;
    await lesson.save();

    return lesson;
  }

  // Thêm 1 tài liệu đính kèm vào lesson — áp dụng cho cả VIDEO lẫn QUIZ.
  public async addAttachment(
    courseId: string,
    lessonId: string,
    instructorId: string,
    documentAssetId: string,
  ) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');

    // Xác minh document asset hợp lệ và thuộc về giảng viên/khóa học/bài học này
    await this.assertDocumentAssetBinding(documentAssetId, courseId, lessonId, instructorId);

    // Tránh thêm trùng
    const assetObjectId = new Types.ObjectId(documentAssetId);
    const alreadyExists = lesson.attachments.some((id) => id.equals(assetObjectId));
    if (alreadyExists) throw new Error('Tài liệu này đã được đính kèm vào bài học.');

    lesson.attachments.push(assetObjectId);
    await lesson.save();

    await publishDocumentAssetAttached({
      assetId: documentAssetId,
      courseId,
      lessonId,
    });

    return lesson;
  }

  // Xóa 1 tài liệu đính kèm khỏi lesson và phát cleanup event.
  public async removeAttachment(
    courseId: string,
    lessonId: string,
    instructorId: string,
    documentAssetId: string,
  ) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');

    const assetObjectId = new Types.ObjectId(documentAssetId);
    const index = lesson.attachments.findIndex((id) => id.equals(assetObjectId));
    if (index === -1) throw new Error('Tài liệu không thuộc bài học này.');

    lesson.attachments.splice(index, 1);
    await lesson.save();

    // Phát cleanup event để media-service xóa file vật lý + record DB
    await mediaReferenceService.cleanupDocumentIfUnused(documentAssetId, {
      courseId,
      lessonId,
    });

    return lesson;
  }

  // Hàm này là điểm nối từ RabbitMQ event video về lại lesson state của course-service.
  public async updateVideoLessonState(data: {
    lessonId: string;
    videoAssetId: string;
    status: LessonStatus.PROCESSING | LessonStatus.READY | LessonStatus.FAILED;
    duration?: number;
  }): Promise<void> {
    const lesson = await Lesson.findById(data.lessonId);
    if (!lesson) return;
    if (lesson.type !== LessonType.VIDEO) return;
    if (!lesson.videoAssetId || lesson.videoAssetId.toString() !== data.videoAssetId) return;

    const update: Record<string, unknown> = {
      videoAssetId: new Types.ObjectId(data.videoAssetId),
      status: data.status,
    };

    if (typeof data.duration === 'number') {
      update.duration = data.duration;
    }

    lesson.set(update);
    await lesson.save();
    await courseService.syncCourseStats(lesson.courseId);
  }

  // dùng để đảm bảo giảng viên sở hữu khóa học
  private async assertCourseOwnership(courseId: string, instructorId: string) {
    const version = await CourseVersion.findById(courseId);
    if (!version) throw new Error('Bản nội dung khóa học không tồn tại.');
    if (version.instructorId !== instructorId) throw new Error('Bạn không có quyền truy cập khóa học này.');
    courseService.assertCourseEditable(version.status);
    return version;
  }
  // dùng để đảm bảo giảng viên sở hữu khóa học và section
  private async assertCourseAndSectionOwnership(courseId: string, sectionId: string, instructorId: string) {
    const course = await this.assertCourseOwnership(courseId, instructorId);
    const section = await Section.findOne({ _id: sectionId, courseId });
    if (!section) throw new Error('Chương không tồn tại.');
    return { course, section };
  }
  // dùng để sắp xếp lại thứ tự bài học sau khi xóa hoặc di chuyển
  private async resequenceLessons(courseId: string, sectionId: string): Promise<void> {
    const lessons = await Lesson.find({ courseId, sectionId }).sort({ order: 1, createdAt: 1 });
    await Promise.all(
      lessons.map((lesson, index) => {
        lesson.order = index + 1;
        return lesson.save();
      })
    );
  }

  // Khi đổi type: chỉ dọn video/quiz — attachments được GIỮ NGUYÊN.
  private async cleanupLessonMediaForTypeChange(lesson: ILesson) {
    await Quiz.deleteOne({ lessonId: lesson._id, courseId: lesson.courseId });

    const courseId = lesson.courseId.toString();
    const lessonId = lesson._id.toString();

    if (lesson.videoAssetId) {
      await mediaReferenceService.cleanupVideoIfUnused(lesson.videoAssetId, {
        courseId,
        lessonId,
      });
    }

    lesson.videoAssetId = null;
    lesson.duration = 0;
  }

  // dùng để chuẩn hóa loại bài học
  private normalizeLessonType(type?: LessonType): LessonType {
    if (!type) return LessonType.VIDEO;
    if (!Object.values(LessonType).includes(type)) throw new Error('Loại bài học không hợp lệ.');
    return type;
  }
  // dùng để chuẩn hóa trạng thái bài học
  private normalizeLessonStatus(status: LessonStatus): LessonStatus {
    if (!Object.values(LessonStatus).includes(status)) throw new Error('Trạng thái bài học không hợp lệ.');
    return status;
  }

  private async assertVideoAssetBinding(
    videoAssetId: string,
    courseId: string,
    lessonId: string,
    instructorId: string,
  ): Promise<void> {
    // Asset lookup là internal synchronous RPC giữa service với service.
    // Dùng gRPC ở đây để giữ schema chặt và bỏ lớp auth-forwarding qua HTTP.
    const asset = await mediaGrpcClient.getVideoAssetBinding(videoAssetId);
    this.assertMediaAssetContext(asset, courseId, lessonId, instructorId, 'Video asset');
  }

  private async assertDocumentAssetBinding(
    documentAssetId: string,
    courseId: string,
    lessonId: string,
    instructorId: string,
  ): Promise<void> {
    const asset = await mediaGrpcClient.getDocumentAssetBinding(documentAssetId);
    this.assertMediaAssetContext(asset, courseId, lessonId, instructorId, 'Document asset');
  }

  private assertMediaAssetContext(
    asset: MediaAssetBindingSnapshot,
    courseId: string,
    lessonId: string,
    instructorId: string,
    label: string,
  ): void {
    if (asset.ownerUserId !== instructorId) {
      throw new Error(`${label} không thuộc quyền sở hữu của tài khoản hiện tại.`);
    }
    if (asset.courseId !== courseId) {
      throw new Error(`${label} không thuộc khóa học hiện tại.`);
    }
    if (asset.lessonId !== lessonId) {
      throw new Error(`${label} không thuộc bài học hiện tại.`);
    }
  }
}

export default new LessonService();
