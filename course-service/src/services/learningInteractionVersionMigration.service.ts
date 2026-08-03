import { Types } from 'mongoose';
import { Course } from '../models/course.model';
import { CourseVersion } from '../models/courseVersion.model';
import { LearningNote } from '../models/learningNote.model';
import { Lesson } from '../models/lesson.model';
import { LessonDiscussion } from '../models/lessonDiscussion.model';
import { LessonDiscussionReaction } from '../models/lessonDiscussionReaction.model';
import { resolveLessonIdentityId } from '../utils/lessonIdentity.utils';

export interface VersionLessonMapping {
  oldLessonId: string;
  newLessonId: string;
}

export interface LearningInteractionMigrationResult {
  discussions: number;
  reactions: number;
  notes: number;
}

class LearningInteractionVersionMigrationService {
  private emptyResult(): LearningInteractionMigrationResult {
    return { discussions: 0, reactions: 0, notes: 0 };
  }

  public async migrateMappings(
    courseId: string,
    mappings: VersionLessonMapping[],
  ): Promise<LearningInteractionMigrationResult> {
    if (!Types.ObjectId.isValid(courseId) || !mappings.length) return this.emptyResult();

    const validMappings = mappings.filter(
      (item) => Types.ObjectId.isValid(item.oldLessonId) && Types.ObjectId.isValid(item.newLessonId),
    );
    if (!validMappings.length) return this.emptyResult();

    const newLessons = await Lesson.find({
      _id: { $in: validMappings.map((item) => new Types.ObjectId(item.newLessonId)) },
    }).select('_id sourceLessonId').lean();
    const newLessonById = new Map(newLessons.map((lesson) => [String(lesson._id), lesson]));
    const result = this.emptyResult();
    const courseObjectId = new Types.ObjectId(courseId);

    for (const mapping of validMappings) {
      const newLesson = newLessonById.get(mapping.newLessonId);
      if (!newLesson) continue;
      const oldLessonId = new Types.ObjectId(mapping.oldLessonId);
      const newLessonId = new Types.ObjectId(mapping.newLessonId);
      const lessonIdentityId = resolveLessonIdentityId(newLesson);

      const [discussionResult, reactionResult, noteResult] = await Promise.all([
        LessonDiscussion.updateMany(
          {
            courseId: courseObjectId,
            $or: [
              { lessonId: oldLessonId },
              { lessonIdentityId, lessonId: { $ne: newLessonId } },
            ],
          },
          { $set: { lessonId: newLessonId, lessonIdentityId } },
        ),
        LessonDiscussionReaction.updateMany(
          {
            courseId: courseObjectId,
            $or: [
              { lessonId: oldLessonId },
              { lessonIdentityId, lessonId: { $ne: newLessonId } },
            ],
          },
          { $set: { lessonId: newLessonId, lessonIdentityId } },
        ),
        // Note có thể có nhiều document lịch sử của cùng user. Chỉ backfill identity ở đây;
        // learningInteractionService sẽ gộp an toàn khi user mở bài học, tránh va chạm unique lessonId.
        LearningNote.updateMany(
          {
            courseId: courseObjectId,
            lessonId: oldLessonId,
          },
          { $set: { lessonIdentityId } },
        ),
      ]);

      result.discussions += discussionResult.modifiedCount;
      result.reactions += reactionResult.modifiedCount;
      result.notes += noteResult.modifiedCount;
    }

    return result;
  }

  public async migrateAllPublishedCourses(): Promise<LearningInteractionMigrationResult> {
    const courses = await Course.find({ currentVersionId: { $ne: null } })
      .select('_id currentVersionId')
      .lean();
    const total = this.emptyResult();

    for (const course of courses) {
      if (!course.currentVersionId) continue;
      const courseVersionIds = await CourseVersion.find({ courseId: course._id }).distinct('_id');
      const currentLessons = await Lesson.find({ courseId: course.currentVersionId })
        .select('_id sourceLessonId')
        .lean();

      for (const currentLesson of currentLessons) {
        const lessonIdentityId = resolveLessonIdentityId(currentLesson);
        const compatibleLessons = await Lesson.find({
          courseId: { $in: courseVersionIds },
          $or: [
            { _id: lessonIdentityId },
            { sourceLessonId: lessonIdentityId },
          ],
        }).select('_id').lean();
        const compatibleLessonIds = compatibleLessons.map((item) => item._id);
        if (!compatibleLessonIds.length) continue;

        const migration = await this.migrateMappings(
          String(course._id),
          compatibleLessonIds
            .filter((lessonId) => !lessonId.equals(currentLesson._id))
            .map((lessonId) => ({
              oldLessonId: String(lessonId),
              newLessonId: String(currentLesson._id),
            })),
        );
        total.discussions += migration.discussions;
        total.reactions += migration.reactions;
        total.notes += migration.notes;

        await Promise.all([
          LessonDiscussion.updateMany(
            { courseId: course._id, lessonId: currentLesson._id },
            { $set: { lessonIdentityId } },
          ),
          LessonDiscussionReaction.updateMany(
            { courseId: course._id, lessonId: currentLesson._id },
            { $set: { lessonIdentityId } },
          ),
          LearningNote.updateMany(
            { courseId: course._id, lessonId: currentLesson._id },
            { $set: { lessonIdentityId } },
          ),
        ]);
      }
    }

    return total;
  }
}

export default new LearningInteractionVersionMigrationService();