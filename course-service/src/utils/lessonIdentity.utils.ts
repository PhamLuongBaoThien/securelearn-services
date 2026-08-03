import { Types } from 'mongoose';

export interface LessonIdentitySource {
  _id: Types.ObjectId;
  sourceLessonId?: Types.ObjectId | null;
}

export const resolveLessonIdentityId = (lesson: LessonIdentitySource): Types.ObjectId =>
  new Types.ObjectId(lesson.sourceLessonId || lesson._id);

export const buildInteractionLessonScope = (
  lessonIdentityId: Types.ObjectId,
  compatibleLessonIds: Types.ObjectId[],
) => ({
  $or: [
    { lessonIdentityId },
    {
      lessonIdentityId: null,
      lessonId: { $in: compatibleLessonIds },
    },
  ],
});