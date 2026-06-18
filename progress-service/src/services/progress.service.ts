import { CourseProgress } from '../models/courseProgress.model';
import {
  LessonProgress,
  LessonProgressStatus,
  LessonProgressType,
  WatchedSegment,
} from '../models/lessonProgress.model';
import { LearningSession, LearningSessionStatus } from '../models/learningSession.model';
import { publishCourseCompleted, publishLessonCompleted } from '../events/publishers';
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
  segmentStartSeconds?: number;
  playbackRate?: number;
  tabVisible?: boolean;
  quizAttemptId?: string;
  deviceInfo?: string;
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
  watchedSegments: WatchedSegment[];
  activeSeconds: number;
  lastPositionSeconds: number;
  completedAt?: Date | null;
  updatedAt?: Date;
};

class ProgressService {
  public async heartbeat(input: HeartbeatInput): Promise<CourseProgressResponse> {
    this.assertHeartbeatPayload(input);
    const context = await this.loadAllowedContext(input.userId, input.userRole, input.courseId);
    const lesson = this.resolveLesson(context, input.lessonId, input.lessonType);
    const activeSeconds = this.normalizeActiveSeconds(input.watchedSecondsDelta);
    await this.upsertLearningSession(input, context, activeSeconds, false);

    if (input.lessonType === LessonProgressType.QUIZ) {
      await this.upsertQuizHeartbeat(input, context);
    } else {
      await this.upsertVideoHeartbeat(input, context, lesson.duration, activeSeconds);
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
    const existing = await LessonProgress.findOne({
      userId: input.userId,
      courseId: context.courseId,
      lessonId: input.lessonId,
    });
    const completedAt = input.passed ? existing?.completedAt || now : null;
    const shouldPublishLessonCompleted = Boolean(input.passed) && existing?.status !== LessonProgressStatus.COMPLETED;
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
      completedAt,
    };

    await LessonProgress.findOneAndUpdate(
      { userId: input.userId, courseId: context.courseId, lessonId: input.lessonId },
      { $set: update },
      { upsert: true, new: true }
    );

    await this.endActiveLearningSessions(input.userId, context.courseId, input.lessonId);
    if (shouldPublishLessonCompleted && completedAt) {
      await publishLessonCompleted({
        userId: input.userId,
        courseId: context.courseId,
        courseVersionId: context.courseVersionId,
        lessonId: input.lessonId,
        lessonType: LessonProgressType.QUIZ,
        completedAt: completedAt.toISOString(),
        quizAttemptId: input.attemptId,
        quizScore: score,
        quizPassed: Boolean(input.passed),
      });
    }

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

  private async upsertVideoHeartbeat(
    input: HeartbeatInput,
    context: CourseProgressContext,
    durationSeconds: number,
    activeSeconds: number
  ) {
    const existing = await LessonProgress.findOne({
      userId: input.userId,
      courseId: context.courseId,
      lessonId: input.lessonId,
    });

    const position = Math.min(durationSeconds || Number.MAX_SAFE_INTEGER, this.toNumber(input.positionSeconds));
    const existingSegments = existing?.watchedSegments?.length
      ? existing.watchedSegments
      : this.segmentsFromLegacyWatchedSeconds(existing?.watchedSeconds || 0, durationSeconds);
    const watchedSegments = this.mergeSegments([
      ...existingSegments,
      ...this.buildHeartbeatSegments(input, position, durationSeconds),
    ]);
    const watchedSeconds = this.sumSegments(watchedSegments);
    const watchPercent = durationSeconds > 0 ? Math.min(100, Math.round((watchedSeconds / durationSeconds) * 100)) : 0;
    const isCompleted = existing?.status === LessonProgressStatus.COMPLETED || watchPercent >= VIDEO_COMPLETE_PERCENT;
    const status = isCompleted ? LessonProgressStatus.COMPLETED : LessonProgressStatus.IN_PROGRESS;
    const completedAt = isCompleted ? existing?.completedAt || new Date() : null;
    const shouldPublishLessonCompleted = isCompleted && existing?.status !== LessonProgressStatus.COMPLETED;

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
          watchedSegments,
          durationSeconds,
          watchPercent,
          lastPositionSeconds: Math.max(existing?.lastPositionSeconds || 0, position),
          completedAt,
        },
      },
      { upsert: true, new: true }
    );

    if (durationSeconds > 0 && position >= durationSeconds - 1) {
      await this.endLearningSession(input.sessionId);
    }
    if (shouldPublishLessonCompleted && completedAt) {
      await publishLessonCompleted({
        userId: input.userId,
        courseId: context.courseId,
        courseVersionId: context.courseVersionId,
        lessonId: input.lessonId,
        lessonType: LessonProgressType.VIDEO,
        completedAt: completedAt.toISOString(),
        watchPercent,
      });
    }
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
    const completedAt = isCompleted ? existing?.completedAt || new Date() : null;
    const shouldPublishCourseCompleted = isCompleted && !existing?.completedAt;
    const nextLastPositionSeconds = existing?.lastLessonId === lastLessonId
      ? Math.max(existing.lastPositionSeconds || 0, lastPositionSeconds)
      : lastPositionSeconds;

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
          lastPositionSeconds: nextLastPositionSeconds,
          completedAt,
        },
        $setOnInsert: {
          startedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    if (shouldPublishCourseCompleted && completedAt) {
      await publishCourseCompleted({
        userId,
        courseId: context.courseId,
        courseVersionId: context.courseVersionId,
        completedLessons,
        totalLessons,
        completedAt: completedAt.toISOString(),
      });
    }
  }

  private async upsertLearningSession(
    input: HeartbeatInput,
    context: CourseProgressContext,
    activeSeconds: number,
    ended: boolean
  ) {
    const now = new Date();
    await LearningSession.findOneAndUpdate(
      { sessionId: input.sessionId },
      {
        $set: {
          userId: input.userId,
          courseId: context.courseId,
          courseVersionId: context.courseVersionId,
          lessonId: input.lessonId,
          lessonType: input.lessonType,
          lastHeartbeatAt: now,
          deviceInfo: input.deviceInfo || '',
          status: ended ? LearningSessionStatus.ENDED : LearningSessionStatus.ACTIVE,
          endedAt: ended ? now : null,
        },
        $inc: {
          heartbeatCount: 1,
          activeSeconds,
        },
        $setOnInsert: {
          sessionId: input.sessionId,
          startedAt: now,
        },
      },
      { upsert: true, new: true }
    );
  }

  private async endLearningSession(sessionId: string) {
    await LearningSession.findOneAndUpdate(
      { sessionId, status: LearningSessionStatus.ACTIVE },
      { $set: { status: LearningSessionStatus.ENDED, endedAt: new Date() } }
    );
  }

  private async endActiveLearningSessions(userId: string, courseId: string, lessonId: string) {
    await LearningSession.updateMany(
      { userId, courseId, lessonId, status: LearningSessionStatus.ACTIVE },
      { $set: { status: LearningSessionStatus.ENDED, endedAt: new Date() } }
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
      watchedSegments: row.watchedSegments || [],
      activeSeconds: row.watchedSeconds || 0,
      lastPositionSeconds: row.lastPositionSeconds || 0,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
    };
  }

  private toNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  private normalizeActiveSeconds(value: unknown) {
    const parsed = this.toNumber(value);
    return parsed > 0 && parsed <= 20 ? parsed : 0;
  }

  private buildHeartbeatSegments(input: HeartbeatInput, position: number, durationSeconds: number): WatchedSegment[] {
    const activeSeconds = this.normalizeActiveSeconds(input.watchedSecondsDelta);
    if (input.lessonType !== LessonProgressType.VIDEO || activeSeconds <= 0 || input.tabVisible === false) return [];
    const playbackRate = Number(input.playbackRate || 1);
    if (!Number.isFinite(playbackRate) || playbackRate <= 0 || playbackRate > 2) return [];

    const rawStart = input.segmentStartSeconds === undefined
      ? position - activeSeconds
      : this.toNumber(input.segmentStartSeconds);
    const start = Math.max(0, Math.min(rawStart, position));
    const maxEnd = durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER;
    const end = Math.min(maxEnd, Math.max(position, start));
    return end > start ? [{ start, end }] : [];
  }

  private mergeSegments(segments: WatchedSegment[]) {
    const sorted = segments
      .map((segment) => ({
        start: this.toNumber(segment.start),
        end: this.toNumber(segment.end),
      }))
      .filter((segment) => segment.end > segment.start)
      .sort((a, b) => a.start - b.start);

    return sorted.reduce<WatchedSegment[]>((merged, segment) => {
      const previous = merged[merged.length - 1];
      if (!previous || segment.start > previous.end) {
        merged.push(segment);
        return merged;
      }
      previous.end = Math.max(previous.end, segment.end);
      return merged;
    }, []);
  }

  private sumSegments(segments: WatchedSegment[]) {
    return segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
  }

  private segmentsFromLegacyWatchedSeconds(watchedSeconds: number, durationSeconds: number): WatchedSegment[] {
    const end = durationSeconds > 0 ? Math.min(watchedSeconds, durationSeconds) : watchedSeconds;
    return end > 0 ? [{ start: 0, end }] : [];
  }
}

export default new ProgressService();
