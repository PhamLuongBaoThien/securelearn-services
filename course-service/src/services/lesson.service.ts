// File này chứa nghiệp vụ chính cho Lesson.
// Ghi nhớ:
// - lesson hỗ trợ 3 type: VIDEO, DOCUMENT, QUIZ
// - lesson.status đi qua DRAFT -> PROCESSING/READY/FAILED tùy loại nội dung
// - đổi lesson.type phải cleanup reference cũ để tránh dữ liệu mồ côi
import { Types } from 'mongoose';
import { Course } from '../models/course.model';
import { ILesson, Lesson, LessonStatus, LessonType } from '../models/lesson.model';
import { Quiz } from '../models/quiz.model';
import { Section } from '../models/section.model';
import courseService from './course.service';
import {
  publishVideoAssetCleanup,
  publishDocumentAssetCleanup,
  publishVideoAssetAttached,
  publishDocumentAssetAttached,
} from '../events/publishers';

interface MediaAssetBindingSnapshot {
  _id: string;
  ownerUserId: string;
  courseId: string;
  lessonId: string;
}

const MEDIA_SERVICE_URL = process.env.MEDIA_SERVICE_URL || 'http://media-service:5003';

class LessonService {
  // Lesson mới mặc định là VIDEO và status DRAFT cho tới khi được bind nội dung hợp lệ.
  public async createLesson(
    courseId: string,
    sectionId: string,
    instructorId: string,
    data: {
      title: string;
      type?: LessonType;
      summary?: string;
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
    const order = data.order ?? (await Lesson.countDocuments({ sectionId: section._id })) + 1; // Nếu không có order thì lấy số lượng bài học + 1
    const existing = await Lesson.findOne({ sectionId: section._id, order }); // kiểm tra thứ tự có tồn tại không
    if (existing) {
      throw new Error('Thứ tự bài học đã tồn tại trong chương này.');
    }

    const lessonType = this.normalizeLessonType(data.type); // chuẩn hóa loại bài học
    const lesson = await Lesson.create({
      courseId: course._id,
      sectionId: section._id,
      title,
      type: lessonType,
      status: LessonStatus.DRAFT,
      summary: data.summary?.trim() || '',
      duration: data.duration ?? 0,
      order,
      isFreePreview: Boolean(data.isFreePreview),
      videoAssetId: null,
      documentAssetId: null,
    });

    await courseService.syncCourseStats(course._id); // syncCourseStats để update totalLessons và totalDuration của course
    return lesson;
  }

  // Nếu đổi type, hệ thống sẽ reset asset/quiz cũ và đưa lesson về DRAFT.
  public async updateLesson(
    courseId: string,
    lessonId: string,
    instructorId: string,
    data: {
      title?: string;
      type?: LessonType;
      summary?: string;
      duration?: number;
      isFreePreview?: boolean;
      status?: LessonStatus;
    }
  ) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId }); // tìm lesson theo lessonId và courseId
    if (!lesson) throw new Error('Bài học không tồn tại.');

    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) throw new Error('Tên bài học không được để trống.');
      lesson.title = title;
    }

    if (data.summary !== undefined) lesson.summary = data.summary.trim();
    if (data.duration !== undefined) lesson.duration = data.duration;
    if (data.isFreePreview !== undefined) lesson.isFreePreview = Boolean(data.isFreePreview);

    if (data.type !== undefined && data.type !== lesson.type) {
      await this.cleanupLessonReferencesForTypeChange(lesson); // clear asset và quiz cũ nếu đổi type
      lesson.type = this.normalizeLessonType(data.type); // chuẩn hóa type
      lesson.status = LessonStatus.DRAFT; // reset status về DRAFT
    } else if (data.status !== undefined) {
      lesson.status = this.normalizeLessonStatus(data.status); // 
    }

    await lesson.save();
    await courseService.syncCourseStats(courseId);
    return lesson;
  }

  // Khi xóa lesson: dọn quiz + phát cleanup event cho media asset trước khi xoá DB.
  public async deleteLesson(courseId: string, lessonId: string, instructorId: string): Promise<void> {
    await this.assertCourseOwnership(courseId, instructorId);
    // Load đầy đủ để kiểm tra asset (không dùng .lean() vì cần document methods)
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');

    // Phát cleanup event cho media asset TRƯỚC khi xoá DB
    // media-service sẽ xoá file vật lý trên R2/S3 + xoá record trong media DB
    if (lesson.videoAssetId) {
      await publishVideoAssetCleanup({
        assetId: lesson.videoAssetId.toString(),
        courseId,
        lessonId,
      });
    }
    if (lesson.documentAssetId) {
      await publishDocumentAssetCleanup({
        assetId: lesson.documentAssetId.toString(),
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
    const lessonIds = items.map((item) => item.lessonId); // lấy danh sách bài học id từ items
    const lessons = await Lesson.find({ courseId, sectionId, _id: { $in: lessonIds } }).select('_id').lean(); // tìm các bài học thuộc chương này có id trong lessonIds
    if (lessons.length !== items.length) { // nếu số lượng bài học tìm được không bằng số lượng bài học trong items thì ném lỗi
      throw new Error('Có bài học không tồn tại hoặc không thuộc chương này.');
    }

    const uniqueOrders = new Set(items.map((item) => item.order)); // lấy danh sách thứ tự bài học và kiểm tra trùng lặp
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
    authorizationHeader?: string,
  ) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.VIDEO) throw new Error('Chỉ bài học video mới được gắn video asset.');
    await this.assertVideoAssetBinding(videoAssetId, courseId, lessonId, instructorId, authorizationHeader);

    const previousVideoAssetId = lesson.videoAssetId?.toString() || null;
    const previousDocumentAssetId = lesson.documentAssetId?.toString() || null;

    lesson.videoAssetId = new Types.ObjectId(videoAssetId);
    lesson.documentAssetId = null;
    lesson.status = LessonStatus.PROCESSING;
    await Quiz.deleteOne({ lessonId: lesson._id, courseId });
    await lesson.save();

    await publishVideoAssetAttached({
      assetId: videoAssetId,
      courseId,
      lessonId,
    });

    if (previousVideoAssetId && previousVideoAssetId !== videoAssetId) {
      await publishVideoAssetCleanup({
        assetId: previousVideoAssetId,
        courseId,
        lessonId,
      });
    }

    if (previousDocumentAssetId) {
      await publishDocumentAssetCleanup({
        assetId: previousDocumentAssetId,
        courseId,
        lessonId,
      });
    }

    return lesson;
  }

  // Document hiện được xem là sẵn sàng ngay sau khi upload + bind xong.
  public async bindDocumentAsset(
    courseId: string,
    lessonId: string,
    instructorId: string,
    documentAssetId: string,
    authorizationHeader?: string,
  ) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.DOCUMENT) throw new Error('Chỉ bài học tài liệu mới được gắn document asset.');
    await this.assertDocumentAssetBinding(documentAssetId, courseId, lessonId, instructorId, authorizationHeader);

    const previousDocumentAssetId = lesson.documentAssetId?.toString() || null;
    const previousVideoAssetId = lesson.videoAssetId?.toString() || null;

    lesson.documentAssetId = new Types.ObjectId(documentAssetId);
    lesson.videoAssetId = null;
    lesson.status = LessonStatus.READY;
    await Quiz.deleteOne({ lessonId: lesson._id, courseId });
    await lesson.save();

    await publishDocumentAssetAttached({
      assetId: documentAssetId,
      courseId,
      lessonId,
    });

    if (previousDocumentAssetId && previousDocumentAssetId !== documentAssetId) {
      await publishDocumentAssetCleanup({
        assetId: previousDocumentAssetId,
        courseId,
        lessonId,
      });
    }

    if (previousVideoAssetId) {
      await publishVideoAssetCleanup({
        assetId: previousVideoAssetId,
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

    // Phát event cleanup để media-service xoá file vật lý (S3 + DB)
    if (lesson.videoAssetId) {
      await publishVideoAssetCleanup({
        assetId: lesson.videoAssetId.toString(),
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

  public async unbindDocumentAsset(courseId: string, lessonId: string, instructorId: string) {
    await this.assertCourseOwnership(courseId, instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.DOCUMENT) throw new Error('Chỉ bài học tài liệu mới được gỡ document asset.');

    // Phát event cleanup để media-service xoá file vật lý (S3 + DB)
    if (lesson.documentAssetId) {
      await publishDocumentAssetCleanup({
        assetId: lesson.documentAssetId.toString(),
        courseId,
        lessonId,
      });
    }

    lesson.documentAssetId = null;
    lesson.status = LessonStatus.DRAFT;
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
    lesson.documentAssetId = null;
    lesson.status = LessonStatus.READY;
    await lesson.save();

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
    }; // nghĩa là tạo ra một object chứa videoAssetId và status.

    if (typeof data.duration === 'number') {
      update.duration = data.duration;
    }

    lesson.set(update);
    await lesson.save();
    await courseService.syncCourseStats(lesson.courseId);
  }

  // dùng để đảm bảo giảng viên sở hữu khóa học
  private async assertCourseOwnership(courseId: string, instructorId: string) {
    const course = await Course.findById(courseId);
    if (!course) throw new Error('Khóa học không tồn tại.');
    if (course.instructorId !== instructorId) throw new Error('Bạn không có quyền truy cập khóa học này.');
    return course;
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
    const lessons = await Lesson.find({ courseId, sectionId }).sort({ order: 1, createdAt: 1 }); // sắp xếp theo thứ tự order và thời gian tạo
    await Promise.all(
      lessons.map((lesson, index) => {
        lesson.order = index + 1; // gán lại order cho bài học
        return lesson.save(); // lưu lại bài học
      })
    );
  }

  // Rule quan trọng: đổi type thì dọn reference cũ để không giữ video/document/quiz sai loại.
  // Phát cleanup events để media-service xoá file vật lý trên S3.
  private async cleanupLessonReferencesForTypeChange(lesson: ILesson) {
    await Quiz.deleteOne({ lessonId: lesson._id, courseId: lesson.courseId });

    const courseId = lesson.courseId.toString();
    const lessonId = lesson._id.toString();

    // Phát event cleanup cho video asset cũ nếu có
    if (lesson.videoAssetId) {
      await publishVideoAssetCleanup({
        assetId: lesson.videoAssetId.toString(),
        courseId,
        lessonId,
      });
    }

    // Phát event cleanup cho document asset cũ nếu có
    if (lesson.documentAssetId) {
      await publishDocumentAssetCleanup({
        assetId: lesson.documentAssetId.toString(),
        courseId,
        lessonId,
      });
    }

    lesson.videoAssetId = null;
    lesson.documentAssetId = null;
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
    authorizationHeader?: string,
  ): Promise<void> {
    const asset = await this.fetchMediaAsset<MediaAssetBindingSnapshot>(
      `/api/media/videos/${videoAssetId}`,
      authorizationHeader,
    );
    this.assertMediaAssetContext(asset, courseId, lessonId, instructorId, 'Video asset');
  }

  private async assertDocumentAssetBinding(
    documentAssetId: string,
    courseId: string,
    lessonId: string,
    instructorId: string,
    authorizationHeader?: string,
  ): Promise<void> {
    const asset = await this.fetchMediaAsset<MediaAssetBindingSnapshot>(
      `/api/media/documents/${documentAssetId}`,
      authorizationHeader,
    );
    this.assertMediaAssetContext(asset, courseId, lessonId, instructorId, 'Document asset');
  }

  private async fetchMediaAsset<T>(path: string, authorizationHeader?: string): Promise<T> {
    if (!authorizationHeader) {
      throw new Error('Thiếu Authorization header để xác minh media asset.');
    }

    const response = await fetch(`${MEDIA_SERVICE_URL}${path}`, {
      headers: {
        Authorization: authorizationHeader,
      },
    });

    const payload = (await response.json()) as { status: string; message?: string; data?: T };
    if (!response.ok || payload.status === 'ERR' || !payload.data) {
      throw new Error(payload.message || 'Không thể xác minh media asset.');
    }

    return payload.data;
  }

  private assertMediaAssetContext(
    asset: MediaAssetBindingSnapshot,
    courseId: string,
    lessonId: string,
    instructorId: string,
    label: string,
  ): void {
    if (asset.ownerUserId !== instructorId) {
      throw new Error(`${label} không thuộc quyền sở hữu của giảng viên hiện tại.`);
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
