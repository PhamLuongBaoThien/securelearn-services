import { Types } from 'mongoose';
import { CourseStatus } from '../models/course.model';
import { CourseVersion } from '../models/courseVersion.model';
import { Lesson } from '../models/lesson.model';
import { publishDocumentAssetCleanup, publishVideoAssetCleanup } from '../events/publishers';

const toObjectId = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);
const ACTIVE_VERSION_STATUSES = [CourseStatus.PUBLISHED, CourseStatus.DRAFT, CourseStatus.PENDING, CourseStatus.REJECTED];

type LessonMediaSnapshot = {
  _id: Types.ObjectId;
  courseId: Types.ObjectId;
  videoAssetId?: Types.ObjectId | null;
  attachments?: Types.ObjectId[];
};

class MediaReferenceService {
  // Dùng cho thao tác gỡ 1 video khỏi 1 lesson.
  // Chỉ phát cleanup nếu không còn lesson nào khác tham chiếu asset này.
  public async cleanupVideoIfUnused(
    assetId: string | Types.ObjectId,
    context: { courseId: string; lessonId: string }
  ): Promise<void> {
    const normalizedAssetId = toObjectId(assetId);
    const stillUsed = await Lesson.exists({
      _id: { $ne: new Types.ObjectId(context.lessonId) },
      videoAssetId: normalizedAssetId,
    });

    if (stillUsed) return;

    await publishVideoAssetCleanup({
      assetId: normalizedAssetId.toString(),
      courseId: context.courseId,
      lessonId: context.lessonId,
    });
  }

  // Dùng cho thao tác gỡ 1 document khỏi 1 lesson.
  // Attachments cũng có thể được nhiều version cùng tham chiếu nên phải kiểm tra trước khi xóa.
  public async cleanupDocumentIfUnused(
    assetId: string | Types.ObjectId,
    context: { courseId: string; lessonId: string }
  ): Promise<void> {
    const normalizedAssetId = toObjectId(assetId);
    const stillUsed = await Lesson.exists({
      _id: { $ne: new Types.ObjectId(context.lessonId) },
      attachments: normalizedAssetId,
    });

    if (stillUsed) return;

    await publishDocumentAssetCleanup({
      assetId: normalizedAssetId.toString(),
      courseId: context.courseId,
      lessonId: context.lessonId,
    });
  }

  // Dùng khi xóa nhiều lesson cùng lúc (xóa section/course/version).
  // Hàm loại trừ toàn bộ lesson sắp xóa bằng $nin để tránh lỗi check chéo giữa các version dùng chung asset.
  public async cleanupMediaForRemovedLessons(lessons: LessonMediaSnapshot[]): Promise<void> {
    if (lessons.length === 0) return;

    const removedLessonIds = lessons.map((lesson) => lesson._id);
    const videoCleanupContexts = new Map<string, { courseId: string; lessonId: string }>();
    const documentCleanupContexts = new Map<string, { courseId: string; lessonId: string }>();

    for (const lesson of lessons) {
      if (lesson.videoAssetId) {
        const assetId = lesson.videoAssetId.toString();
        if (!videoCleanupContexts.has(assetId)) {
          videoCleanupContexts.set(assetId, {
            courseId: lesson.courseId.toString(),
            lessonId: lesson._id.toString(),
          });
        }
      }

      for (const attachmentId of lesson.attachments || []) {
        const assetId = attachmentId.toString();
        if (!documentCleanupContexts.has(assetId)) {
          documentCleanupContexts.set(assetId, {
            courseId: lesson.courseId.toString(),
            lessonId: lesson._id.toString(),
          });
        }
      }
    }

    const videoAssetIdsToQuery = Array.from(videoCleanupContexts.keys()).map((id) => new Types.ObjectId(id));
    const documentAssetIdsToQuery = Array.from(documentCleanupContexts.keys()).map((id) => new Types.ObjectId(id));

    // distinct trả về assetId duy nhất còn được dùng ngoài nhóm lesson sắp xóa.
    const [stillUsedVideoIdsArray, stillUsedDocumentIdsArray] = await Promise.all([
      videoCleanupContexts.size > 0
        ? Lesson.distinct('videoAssetId', {
            _id: { $nin: removedLessonIds },
            videoAssetId: { $in: videoAssetIdsToQuery },
          })
        : Promise.resolve([]),
      documentCleanupContexts.size > 0
        ? Lesson.distinct('attachments', {
            _id: { $nin: removedLessonIds },
            attachments: { $in: documentAssetIdsToQuery },
          })
        : Promise.resolve([]),
    ]);

    const stillUsedVideoAssetIds = new Set(
      stillUsedVideoIdsArray.map((id: any) => id.toString())
    );
    const stillUsedDocumentAssetIds = new Set(
      stillUsedDocumentIdsArray.map((id: any) => id.toString())
    );

    await Promise.all([
      ...Array.from(videoCleanupContexts.entries())
        .filter(([assetId]) => !stillUsedVideoAssetIds.has(assetId))
        .map(([assetId, context]) => publishVideoAssetCleanup({ assetId, ...context })),
      ...Array.from(documentCleanupContexts.entries())
        .filter(([assetId]) => !stillUsedDocumentAssetIds.has(assetId))
        .map(([assetId, context]) => publishDocumentAssetCleanup({ assetId, ...context })),
    ]);
  }

  // Chạy sau khi admin approve version mới.
  // Media chỉ còn nằm trong ARCHIVED versions sẽ bị xóa; media còn ở PUBLISHED/DRAFT/PENDING/REJECTED được giữ lại.
  public async cleanupArchivedVersionMedia(courseId: string | Types.ObjectId): Promise<void> {
    const normalizedCourseId = toObjectId(courseId);
    const versions = await CourseVersion.find({ courseId: normalizedCourseId })
      .select('_id status')
      .lean();

    const activeVersionIds = versions
      .filter((version) => ACTIVE_VERSION_STATUSES.includes(version.status as CourseStatus))
      .map((version) => version._id);
    const archivedVersionIds = versions
      .filter((version) => version.status === CourseStatus.ARCHIVED)
      .map((version) => version._id);

    if (archivedVersionIds.length === 0) return;

    const [activeLessons, archivedLessons] = await Promise.all([
      activeVersionIds.length > 0
        ? Lesson.find({ courseId: { $in: activeVersionIds } }).select('videoAssetId attachments').lean()
        : [],
      Lesson.find({ courseId: { $in: archivedVersionIds } }).select('_id courseId videoAssetId attachments').lean(),
    ]);

    const activeVideoAssetIds = new Set<string>();
    const activeDocumentAssetIds = new Set<string>();
    for (const lesson of activeLessons) {
      if (lesson.videoAssetId) activeVideoAssetIds.add(lesson.videoAssetId.toString());
      for (const attachmentId of lesson.attachments || []) {
        activeDocumentAssetIds.add(attachmentId.toString());
      }
    }

    const archivedVideoCleanupContexts = new Map<string, { courseId: string; lessonId: string }>();
    const archivedDocumentCleanupContexts = new Map<string, { courseId: string; lessonId: string }>();
    for (const lesson of archivedLessons) {
      if (lesson.videoAssetId) {
        const assetId = lesson.videoAssetId.toString();
        if (!activeVideoAssetIds.has(assetId) && !archivedVideoCleanupContexts.has(assetId)) {
          archivedVideoCleanupContexts.set(assetId, {
            courseId: lesson.courseId.toString(),
            lessonId: lesson._id.toString(),
          });
        }
      }

      for (const attachmentId of lesson.attachments || []) {
        const assetId = attachmentId.toString();
        if (!activeDocumentAssetIds.has(assetId) && !archivedDocumentCleanupContexts.has(assetId)) {
          archivedDocumentCleanupContexts.set(assetId, {
            courseId: lesson.courseId.toString(),
            lessonId: lesson._id.toString(),
          });
        }
      }
    }

    await Promise.all([
      ...Array.from(archivedVideoCleanupContexts.entries()).map(([assetId, context]) =>
        publishVideoAssetCleanup({ assetId, ...context })
      ),
      ...Array.from(archivedDocumentCleanupContexts.entries()).map(([assetId, context]) =>
        publishDocumentAssetCleanup({ assetId, ...context })
      ),
    ]);
  }
}

export default new MediaReferenceService();
