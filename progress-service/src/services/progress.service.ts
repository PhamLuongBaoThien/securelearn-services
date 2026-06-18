import { CourseProgress } from '../models/courseProgress.model';
import {
  LessonProgress,
  LessonProgressStatus,
  LessonProgressType,
} from '../models/lessonProgress.model';
import courseContextService, { CourseProgressContext } from './courseContext.service';

const VIDEO_COMPLETE_PERCENT = 90;

type HeartbeatInput = {
  userId: string;
  userRole: string;
  courseId: string;
  lessonId: string;
  lessonType: LessonProgressType;
  sessionId: string;
  positionSeconds?: number;
  watchedSecondsDelta?: number;
  quizAttemptId?: string;
};

type QuizCompleteInput = {
  userId: string;
  userRole: string;
  courseId: string;
  lessonId: string;
  attemptId: string;
  score: number;
  passed: boolean;
};

type CourseProgressResponse = {
  course: CourseProgressSummary;
  lessons: Record<string, LessonProgressSummary>;
};

export type CourseProgressSummary = {
  courseId: string;
  courseVersionId: string;
  progressPercent: number;
  completedLessons: number;
  totalLessons: number;
  lastLessonId: string;
  lastPositionSeconds: number;
  completedAt?: Date | null;
  updatedAt?: Date;
};

export type LessonProgressSummary = {
  lessonId: string;
  lessonType: LessonProgressType;
  status: LessonProgressStatus;
  watchedSeconds: number;
  durationSeconds: number;
  watchPercent: number;
  quizAttemptId: string;
  quizScore: number;
  quizPassed: boolean;
  lastPositionSeconds: number;
  completedAt?: Date | null;
  updatedAt?: Date;
};

class ProgressService {
  public async heartbeat(input: HeartbeatInput): Promise<CourseProgressResponse> {
    this.assertHeartbeatPayload(input);
    const context = await this.loadAllowedContext(input.userId, input.userRole, input.courseId);
    const lesson = this.resolveLesson(context, input.lessonId, input.lessonType);

    if (input.lessonType === LessonProgressType.QUIZ) {
      await this.upsertQuizHeartbeat(input, context);
    } else {
      await this.upsertVideoHeartbeat(input, context, lesson.duration);
    }

    await this.recalculateCourseProgress(input.userId, context, input.lessonId, this.toNumber(input.positionSeconds));
    return this.getCourseProgress(input.userId, input.userRole, input.courseId);
  }

  public async quizComplete(input: QuizCompleteInput): Promise<CourseProgressResponse> {
    this.assertQuizCompletePayload(input);
    const context = await this.loadAllowedContext(input.userId, input.userRole, input.courseId);
    this.resolveLesson(context, input.lessonId, LessonProgressType.QUIZ);

    const now = new Date();
    const score = Math.max(0, Math.min(100, Math.round(Number(input.score))));
      const update = {
      userId: input.userId,
      courseId: context.courseId,
      courseVersionId: context.courseVersionId,
      lessonId: input.lessonId,
      lessonType: LessonProgressType.QUIZ,
      quizAttemptId: input.attemptId,
      quizScore: score,
      quizPassed: Boolean(input.passed),
      status: input.passed ? LessonProgressStatus.COMPLETED : LessonProgressStatus.IN_PROGRESS,
      completedAt: input.passed ? now : null,
    };

    await LessonProgress.findOneAndUpdate(
      { userId: input.userId, courseId: context.courseId, lessonId: input.lessonId },
      { $set: update },
      { upsert: true, new: true }
    );

    await this.recalculateCourseProgress(input.userId, context, input.lessonId, 0);
    return this.getCourseProgress(input.userId, input.userRole, input.courseId);
  }

  public async getCourseProgress(userId: string, userRole: string, courseId: string): Promise<CourseProgressResponse> {
    const context = await this.loadAllowedContext(userId, userRole, courseId);
    let courseProgress = await CourseProgress.findOne({ userId, courseId: context.courseId }).lean();
    if (!courseProgress) {
      courseProgress = this.emptyCourseProgress(userId, context) as any;
    }

    const lessonRows = await LessonProgress.find({ userId, courseId: context.courseId }).lean();
    const lessons = lessonRows.reduce<Record<string, LessonProgressSummary>>((map, row) => {
      map[row.lessonId] = this.mapLesson(row);
      return map;
    }, {});

    return {
      course: this.mapCourse(courseProgress),
      lessons,
    };
  }

  public async getMyCoursesProgress(userId: string, courseIds: string[]): Promise<CourseProgressSummary[]> {
    const query: Record<string, unknown> = { userId };
    if (courseIds.length > 0) query.courseId = { $in: courseIds };
    const rows = await CourseProgress.find(query).lean();
    return rows.map((row) => this.mapCourse(row));
  }

  private async upsertVideoHeartbeat(input: HeartbeatInput, context: CourseProgressContext, durationSeconds: number) {
    const existing = await LessonProgress.findOne({
      userId: input.userId,
      courseId: context.courseId,
      lessonId: input.lessonId,
    });

    const position = Math.min(durationSeconds || Number.MAX_SAFE_INTEGER, this.toNumber(input.positionSeconds));
    const currentWatched = existing?.watchedSeconds || 0;
    const watchedSeconds = Math.max(currentWatched, position);
    const watchPercent = durationSeconds > 0 ? Math.min(100, Math.round((watchedSeconds / durationSeconds) * 100)) : 0;
    const isCompleted = existing?.status === LessonProgressStatus.COMPLETED || watchPercent >= VIDEO_COMPLETE_PERCENT;
    const status = isCompleted ? LessonProgressStatus.COMPLETED : LessonProgressStatus.IN_PROGRESS;
    const completedAt = isCompleted ? existing?.completedAt || new Date() : null;

    await LessonProgress.findOneAndUpdate(
      { userId: input.userId, courseId: context.courseId, lessonId: input.lessonId },
      {
        $set: {
          userId: input.userId,
          courseId: context.courseId,
          courseVersionId: context.courseVersionId,
          lessonId: input.lessonId,
          lessonType: LessonProgressType.VIDEO,
          status,
          watchedSeconds,
          durationSeconds,
          watchPercent,
          lastPositionSeconds: Math.max(existing?.lastPositionSeconds || 0, position),
          completedAt,
        },
      },
      { upsert: true, new: true }
    );
  }

  private async upsertQuizHeartbeat(input: HeartbeatInput, context: CourseProgressContext) {
    const existing = await LessonProgress.findOne({
      userId: input.userId,
      courseId: context.courseId,
      lessonId: input.lessonId,
    });
    const status = existing?.status === LessonProgressStatus.COMPLETED
      ? LessonProgressStatus.COMPLETED
      : LessonProgressStatus.IN_PROGRESS;

    await LessonProgress.findOneAndUpdate(
      { userId: input.userId, courseId: context.courseId, lessonId: input.lessonId },
      {
        $set: {
          userId: input.userId,
          courseId: context.courseId,
          courseVersionId: context.courseVersionId,
          lessonId: input.lessonId,
          lessonType: LessonProgressType.QUIZ,
          status,
          quizAttemptId: input.quizAttemptId || existing?.quizAttemptId || '',
        },
      },
      { upsert: true, new: true }
    );
  }

  private async recalculateCourseProgress(
    userId: string,
    context: CourseProgressContext,
    lastLessonId: string,
    lastPositionSeconds: number
  ) {
    const completedLessons = await LessonProgress.countDocuments({
      userId,
      courseId: context.courseId,
      status: LessonProgressStatus.COMPLETED,
    });
    const totalLessons = context.totalLessons;
    const progressPercent = totalLessons > 0 ? Math.min(100, Math.round((completedLessons / totalLessons) * 100)) : 0;
    const isCompleted = totalLessons > 0 && completedLessons >= totalLessons;
    const existing = await CourseProgress.findOne({ userId, courseId: context.courseId });

    await CourseProgress.findOneAndUpdate(
      { userId, courseId: context.courseId },
      {
        $set: {
          userId,
          courseId: context.courseId,
          courseVersionId: context.courseVersionId,
          progressPercent,
          completedLessons,
          totalLessons,
          lastLessonId,
          lastPositionSeconds,
          completedAt: isCompleted ? existing?.completedAt || new Date() : null,
        },
        $setOnInsert: {
          startedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  }

  private async loadAllowedContext(userId: string, userRole: string, courseId: string) {
    const context = await courseContextService.getContext({ userId, userRole, courseId });
    if (!context.allowed) {
      throw new Error(context.reason || 'Bạn không có quyền ghi nhận tiến độ cho khóa học này.');
    }
    return context;
  }

  private resolveLesson(context: CourseProgressContext, lessonId: string, lessonType: LessonProgressType) {
    const lesson = context.lessons.find((item) => item.lessonId === lessonId);
    if (!lesson) throw new Error('Bài học không thuộc khóa học hiện tại.');
    if (lesson.type !== lessonType) throw new Error('Loại bài học không khớp với tiến độ gửi lên.');
    return lesson;
  }

  private assertHeartbeatPayload(input: HeartbeatInput) {
    if (!input.courseId || !input.lessonId || !input.lessonType || !input.sessionId) {
      throw new Error('Thiếu dữ liệu heartbeat tiến độ.');
    }
    if (![LessonProgressType.VIDEO, LessonProgressType.QUIZ].includes(input.lessonType)) {
      throw new Error('Loại bài học không hợp lệ.');
    }
  }

  private assertQuizCompletePayload(input: QuizCompleteInput) {
    if (!input.courseId || !input.lessonId || !input.attemptId) {
      throw new Error('Thiếu dữ liệu hoàn thành quiz.');
    }
  }

  private emptyCourseProgress(userId: string, context: CourseProgressContext): CourseProgressSummary {
    return {
      courseId: context.courseId,
      courseVersionId: context.courseVersionId,
      progressPercent: 0,
      completedLessons: 0,
      totalLessons: context.totalLessons,
      lastLessonId: '',
      lastPositionSeconds: 0,
    };
  }

  private mapCourse(row: any): CourseProgressSummary {
    return {
      courseId: row.courseId,
      courseVersionId: row.courseVersionId,
      progressPercent: row.progressPercent || 0,
      completedLessons: row.completedLessons || 0,
      totalLessons: row.totalLessons || 0,
      lastLessonId: row.lastLessonId || '',
      lastPositionSeconds: row.lastPositionSeconds || 0,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapLesson(row: any): LessonProgressSummary {
    return {
      lessonId: row.lessonId,
      lessonType: row.lessonType,
      status: row.status,
      watchedSeconds: row.watchedSeconds || 0,
      durationSeconds: row.durationSeconds || 0,
      watchPercent: row.watchPercent || 0,
      quizAttemptId: row.quizAttemptId || '',
      quizScore: row.quizScore || 0,
      quizPassed: Boolean(row.quizPassed),
      lastPositionSeconds: row.lastPositionSeconds || 0,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
    };
  }

  private toNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }
}

export default new ProgressService();
