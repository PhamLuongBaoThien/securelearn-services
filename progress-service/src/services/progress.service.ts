import { CourseProgress } from '../models/courseProgress.model';
import { CourseVersionPublishedPayload } from '@securelearn/common';
import {
  LessonProgress,
  LessonProgressStatus,
  LessonProgressType,
  WatchedSegment,
} from '../models/lessonProgress.model';
import { LearningSession, LearningSessionStatus } from '../models/learningSession.model';
import { LearnerActivityDaily } from '../models/learnerActivityDaily.model';
import { publishCourseCompleted, publishLessonCompleted } from '../events/publishers';
import courseContextService, { CourseLessonContext, CourseProgressContext, ProgressionMode } from './courseContext.service';

const VIDEO_COMPLETE_PERCENT = 90;
const STREAK_MIN_ACTIVE_SECONDS = 5 * 60;
const ACTIVITY_TIME_ZONE = 'Asia/Bangkok';

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

export type LessonAccessSummary = {
  lessonId: string;
  locked: boolean;
  reason?: string;
  requiredLessonIds?: string[];
};

export type CourseAccessResponse = {
  courseId: string;
  progressionMode: ProgressionMode;
  lessons: Record<string, LessonAccessSummary>;
};

export type LearnerActivityResponse = {
  totalActiveSeconds: number;
  activeDays: number;
  currentStreakDays: number;
  dailyGoalSeconds: number;
  todayActiveSeconds: number;
  todayGoalCompleted: boolean;
  todayRemainingSeconds: number;
  streakAtRisk: boolean;
  currentDate: string;
  days: Array<{
    date: string;
    activeSeconds: number;
    completedLessons: number;
    completedCourses: number;
  }>;
};

export type CourseAnalyticsResponse = {
  courseId: string;
  totalLearners: number;
  completedLearners: number;
  completionRate: number;
  lessons: Array<{
    lessonId: string;
    lessonType: LessonProgressType;
    startedCount: number;
    completedCount: number;
    completionRate: number;
    averageWatchPercent?: number;
    quizPassRate?: number;
    averageQuizScore?: number;
  }>;
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
    await this.ensureCurrentVersionLessonProgress(input.userId, context);
    const lesson = this.resolveLesson(context, input.lessonId, input.lessonType);
    await this.assertLessonUnlocked(input.userId, context, input.lessonId);
    const activeSeconds = this.normalizeActiveSeconds(input.watchedSecondsDelta);
    await this.upsertLearningSession(input, context, activeSeconds, false);

    if (input.lessonType === LessonProgressType.QUIZ) {
      await this.upsertQuizHeartbeat(input, context);
    } else {
      await this.upsertVideoHeartbeat(input, context, lesson.duration);
    }

    if (activeSeconds > 0) {
      await this.recordDailyActivity(input.userId, activeSeconds, 1, 0, 0);
    }

    await this.recalculateCourseProgress(input.userId, context, input.lessonId, this.toNumber(input.positionSeconds));
    return this.getCourseProgress(input.userId, input.userRole, input.courseId);
  }

  public async quizComplete(input: QuizCompleteInput): Promise<CourseProgressResponse> {
    this.assertQuizCompletePayload(input);
    const context = await this.loadAllowedContext(input.userId, input.userRole, input.courseId);
    await this.ensureCurrentVersionLessonProgress(input.userId, context);
    this.resolveLesson(context, input.lessonId, LessonProgressType.QUIZ);
    await this.assertLessonUnlocked(input.userId, context, input.lessonId);

    const now = new Date();
    const score = Math.max(0, Math.min(100, Math.round(Number(input.score))));
    const existing = await LessonProgress.findOne({
      userId: input.userId,
      courseId: context.courseId,
      lessonId: input.lessonId,
    });
    const wasCompleted = existing?.status === LessonProgressStatus.COMPLETED;
    const isCompleted = wasCompleted || Boolean(input.passed);
    const completedAt = isCompleted ? existing?.completedAt || now : null;
    const shouldPublishLessonCompleted = Boolean(input.passed) && !wasCompleted;
    const shouldUpdateCompletionMetadata = Boolean(input.passed) || !wasCompleted;
    const update = {
      userId: input.userId,
      courseId: context.courseId,
      courseVersionId: context.courseVersionId,
      lessonId: input.lessonId,
      lessonType: LessonProgressType.QUIZ,
      quizAttemptId: shouldUpdateCompletionMetadata ? input.attemptId : existing?.quizAttemptId || '',
      quizScore: input.passed ? Math.max(existing?.quizScore || 0, score) : wasCompleted ? existing?.quizScore || 0 : score,
      quizPassed: Boolean(existing?.quizPassed || input.passed),
      status: isCompleted ? LessonProgressStatus.COMPLETED : LessonProgressStatus.IN_PROGRESS,
      completedAt,
    };

    await LessonProgress.findOneAndUpdate(
      { userId: input.userId, courseId: context.courseId, lessonId: input.lessonId },
      { $set: update },
      { upsert: true, new: true }
    );

    await this.endActiveLearningSessions(input.userId, context.courseId, input.lessonId);
    if (shouldPublishLessonCompleted && completedAt) {
      await this.recordDailyActivity(input.userId, 0, 0, 1, 0);
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
    await this.ensureCurrentVersionLessonProgress(userId, context);
    const lessonRows = await LessonProgress.find({
      userId,
      courseId: context.courseId,
      courseVersionId: context.courseVersionId,
    }).lean();
    let courseProgress = await this.syncCourseProgressSnapshot(userId, context, lessonRows);
    if (!courseProgress) {
      courseProgress = this.emptyCourseProgress(userId, context) as any;
    }
    const lessons = lessonRows.reduce<Record<string, LessonProgressSummary>>((map, row) => {
      map[row.lessonId] = this.mapLesson(row);
      return map;
    }, {});

    return {
      course: this.mapCourse(courseProgress),
      lessons,
    };
  }

  public async getMyCoursesProgress(userId: string, userRole: string, courseIds: string[]): Promise<CourseProgressSummary[]> {
    if (courseIds.length > 0) {
      const rows = await Promise.all(courseIds.map(async (courseId) => {
        try {
          const context = await this.loadAllowedContext(userId, userRole, courseId);
          await this.ensureCurrentVersionLessonProgress(userId, context);
          const lessonRows = await LessonProgress.find({
            userId,
            courseId: context.courseId,
            courseVersionId: context.courseVersionId,
          }).lean();
          const synced = await this.syncCourseProgressSnapshot(userId, context, lessonRows);
          return synced ? this.mapCourse(synced) : this.emptyCourseProgress(userId, context);
        } catch {
          return null;
        }
      }));
      return rows.filter((row): row is CourseProgressSummary => Boolean(row));
    }

    const query: Record<string, unknown> = { userId };
    const rows = await CourseProgress.find(query).lean();
    return rows.map((row) => this.mapCourse(row));
  }

  public async migrateCourseVersionProgress(payload: CourseVersionPublishedPayload): Promise<void> {
    if (!payload.courseId || !payload.oldVersionId || !payload.newVersionId || !payload.lessonMappings?.length) {
      return;
    }

    const lessonIdMap = new Map(payload.lessonMappings.map((item) => [item.oldLessonId, item.newLessonId]));
    const newLessonIds = payload.lessonMappings.map((item) => item.newLessonId);
    const oldLessonRows = await LessonProgress.find({
      courseId: payload.courseId,
      lessonId: { $in: [...lessonIdMap.keys()] },
    }).lean();
    const affectedUserIds = new Set<string>();

    for (const oldRow of oldLessonRows) {
      const newLessonId = lessonIdMap.get(oldRow.lessonId);
      if (!newLessonId) continue;
      affectedUserIds.add(oldRow.userId);

      const existing = await LessonProgress.findOne({
        userId: oldRow.userId,
        courseId: payload.courseId,
        lessonId: newLessonId,
      });
      const nextStatus = existing?.status === LessonProgressStatus.COMPLETED || oldRow.status === LessonProgressStatus.COMPLETED
        ? LessonProgressStatus.COMPLETED
        : existing?.status || oldRow.status;
      const nextCompletedAt = existing?.completedAt || oldRow.completedAt || null;

      await LessonProgress.findOneAndUpdate(
        { userId: oldRow.userId, courseId: payload.courseId, lessonId: newLessonId },
        {
          $set: {
            userId: oldRow.userId,
            courseId: payload.courseId,
            courseVersionId: payload.newVersionId,
            lessonId: newLessonId,
            lessonType: oldRow.lessonType,
            status: nextStatus,
            watchedSegments: existing?.watchedSegments?.length ? existing.watchedSegments : oldRow.watchedSegments || [],
            quizAttemptId: existing?.quizAttemptId || oldRow.quizAttemptId || '',
            quizPassed: Boolean(existing?.quizPassed || oldRow.quizPassed),
            completedAt: nextCompletedAt,
          },
          $max: {
            watchedSeconds: oldRow.watchedSeconds || 0,
            durationSeconds: oldRow.durationSeconds || 0,
            watchPercent: oldRow.watchPercent || 0,
            quizScore: oldRow.quizScore || 0,
            lastPositionSeconds: oldRow.lastPositionSeconds || 0,
          },
        },
        { upsert: true, new: true }
      );
    }

    const courseProgressRows = await CourseProgress.find({
      courseId: payload.courseId,
      courseVersionId: payload.oldVersionId,
    }).lean();
    courseProgressRows.forEach((row) => affectedUserIds.add(row.userId));

    for (const userId of affectedUserIds) {
      const existingCourseProgress = await CourseProgress.findOne({ userId, courseId: payload.courseId });
      const completedLessons = await LessonProgress.countDocuments({
        userId,
        courseId: payload.courseId,
        courseVersionId: payload.newVersionId,
        lessonId: { $in: newLessonIds },
        status: LessonProgressStatus.COMPLETED,
      });
      const totalLessons = payload.totalLessons || existingCourseProgress?.totalLessons || newLessonIds.length;
      const progressPercent = totalLessons > 0 ? Math.min(100, Math.round((completedLessons / totalLessons) * 100)) : 0;
      const mappedLastLessonId = existingCourseProgress?.lastLessonId
        ? lessonIdMap.get(existingCourseProgress.lastLessonId) || existingCourseProgress.lastLessonId
        : '';
      const completedAt = totalLessons > 0 && completedLessons >= totalLessons
        ? existingCourseProgress?.completedAt || new Date(payload.publishedAt || Date.now())
        : null;

      await CourseProgress.findOneAndUpdate(
        { userId, courseId: payload.courseId },
        {
          $set: {
            courseVersionId: payload.newVersionId,
            completedLessons,
            totalLessons,
            progressPercent,
            lastLessonId: mappedLastLessonId,
            completedAt,
          },
          $setOnInsert: {
            startedAt: new Date(payload.publishedAt || Date.now()),
          },
        },
        { upsert: true, new: true }
      );
    }
  }

  public async getCourseAccess(userId: string, userRole: string, courseId: string): Promise<CourseAccessResponse> {
    const context = await this.loadReadableContext(userId, userRole, courseId);
    if (context.reason === 'OWNER_PREVIEW') {
      return {
        courseId: context.courseId,
        progressionMode: context.progressionMode,
        lessons: context.lessons.reduce<Record<string, LessonAccessSummary>>((map, lesson) => {
          map[lesson.lessonId] = { lessonId: lesson.lessonId, locked: false };
          return map;
        }, {}),
      };
    }

    await this.ensureCurrentVersionLessonProgress(userId, context);
    const completedRows = await LessonProgress.find({
      userId,
      courseId: context.courseId,
      courseVersionId: context.courseVersionId,
      status: LessonProgressStatus.COMPLETED,
    })
      .select('lessonId')
      .lean();
    const completedLessonIds = new Set(completedRows.map((row) => row.lessonId));
    const sortedLessons = this.sortLessons(context.lessons);
    const lessons = sortedLessons.reduce<Record<string, LessonAccessSummary>>((map, lesson, index) => {
      map[lesson.lessonId] = this.resolveLessonAccess(
        lesson,
        index,
        sortedLessons,
        completedLessonIds,
        context.progressionMode
      );
      return map;
    }, {});

    return {
      courseId: context.courseId,
      progressionMode: context.progressionMode,
      lessons,
    };
  }

  public async getLearnerActivity(userId: string, from?: string, to?: string): Promise<LearnerActivityResponse> {
    const query: Record<string, unknown> = { userId };
    if (from || to) {
      query.date = {};
      if (from) (query.date as Record<string, string>).$gte = from;
      if (to) (query.date as Record<string, string>).$lte = to;
    }

    const [rows, streakRows] = await Promise.all([
      LearnerActivityDaily.find(query).sort({ date: 1 }).lean(),
      LearnerActivityDaily.find({
        userId,
        activeSeconds: { $gte: STREAK_MIN_ACTIVE_SECONDS },
      })
        .select({ date: 1 })
        .lean(),
    ]);
    const days = rows.map((row) => ({
      date: row.date,
      activeSeconds: row.activeSeconds || 0,
      completedLessons: row.completedLessons || 0,
      completedCourses: row.completedCourses || 0,
    }));
    const totalActiveSeconds = days.reduce((sum, day) => sum + day.activeSeconds, 0);
    const activeDaySet = new Set(days.filter((day) => day.activeSeconds > 0).map((day) => day.date));
    const streakDaySet = new Set(streakRows.map((day) => day.date));
    const currentDate = this.todayKey();
    const yesterdayDate = this.addDaysKey(currentDate, -1);
    const todayActiveSeconds = days.find((day) => day.date === currentDate)?.activeSeconds
      ?? await this.getDailyActiveSeconds(userId, currentDate);
    const todayGoalCompleted = todayActiveSeconds >= STREAK_MIN_ACTIVE_SECONDS;
    const currentStreakDays = todayGoalCompleted
      ? this.calculateCurrentStreak(streakDaySet, currentDate)
      : streakDaySet.has(yesterdayDate)
        ? this.calculateCurrentStreak(streakDaySet, yesterdayDate)
        : 0;

    return {
      totalActiveSeconds,
      activeDays: activeDaySet.size,
      currentStreakDays,
      dailyGoalSeconds: STREAK_MIN_ACTIVE_SECONDS,
      todayActiveSeconds,
      todayGoalCompleted,
      todayRemainingSeconds: Math.max(0, STREAK_MIN_ACTIVE_SECONDS - todayActiveSeconds),
      streakAtRisk: currentStreakDays > 0 && !todayGoalCompleted,
      currentDate,
      days,
    };
  }

  public async getInstructorCourseAnalytics(
    userId: string,
    userRole: string,
    courseId: string
  ): Promise<CourseAnalyticsResponse> {
    const context = await this.loadReadableContext(userId, userRole, courseId);
    if (userRole !== 'INSTRUCTOR' || context.instructorId !== userId) {
      throw new Error('Chỉ giảng viên sở hữu khóa học mới được xem analytics.');
    }

    const [courseRows, lessonRows] = await Promise.all([
      CourseProgress.find({ courseId: context.courseId }).lean(),
      LessonProgress.find({ courseId: context.courseId, courseVersionId: context.courseVersionId }).lean(),
    ]);
    const learnerIds = new Set<string>();
    courseRows.forEach((row) => learnerIds.add(row.userId));
    lessonRows.forEach((row) => learnerIds.add(row.userId));
    const totalLearners = learnerIds.size;
    const completedLearners = courseRows.filter((row) => Boolean(row.completedAt)).length;

    const lessons = this.sortLessons(context.lessons).map((lesson) => {
      const rows = lessonRows.filter((row) => row.lessonId === lesson.lessonId);
      const startedLearners = new Set(rows.map((row) => row.userId));
      const completedCount = rows.filter((row) => row.status === LessonProgressStatus.COMPLETED).length;
      const summary: CourseAnalyticsResponse['lessons'][number] = {
        lessonId: lesson.lessonId,
        lessonType: lesson.type as LessonProgressType,
        startedCount: startedLearners.size,
        completedCount,
        completionRate: this.percent(completedCount, startedLearners.size),
      };

      if (lesson.type === LessonProgressType.VIDEO) {
        summary.averageWatchPercent = this.average(rows.map((row) => row.watchPercent || 0));
      }
      if (lesson.type === LessonProgressType.QUIZ) {
        const quizRows = rows.filter((row) => row.quizAttemptId || row.quizScore !== undefined);
        summary.quizPassRate = this.percent(quizRows.filter((row) => row.quizPassed).length, quizRows.length);
        summary.averageQuizScore = this.average(quizRows.map((row) => row.quizScore || 0));
      }

      return summary;
    });

    return {
      courseId: context.courseId,
      totalLearners,
      completedLearners,
      completionRate: this.percent(completedLearners, totalLearners),
      lessons,
    };
  }
  private async upsertVideoHeartbeat(
    input: HeartbeatInput,
    context: CourseProgressContext,
    durationSeconds: number
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
      await this.recordDailyActivity(input.userId, 0, 0, 1, 0);
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

  private async upsertQuizHeartbeat(
    input: HeartbeatInput,
    context: CourseProgressContext
  ) {
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
      courseVersionId: context.courseVersionId,
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
      await this.recordDailyActivity(userId, 0, 0, 0, 1);
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

  private async syncCourseProgressSnapshot(
    userId: string,
    context: CourseProgressContext,
    lessonRows: Array<any>
  ) {
    const existing = await CourseProgress.findOne({ userId, courseId: context.courseId });
    const completedLessons = lessonRows.filter((row) => row.status === LessonProgressStatus.COMPLETED).length;
    const totalLessons = context.totalLessons;
    const progressPercent = totalLessons > 0 ? Math.min(100, Math.round((completedLessons / totalLessons) * 100)) : 0;
    const completedAt = totalLessons > 0 && completedLessons >= totalLessons
      ? existing?.completedAt || new Date()
      : null;
    const currentLessonIds = new Set(lessonRows.map((row) => row.lessonId));
    const latestLessonRow = [...lessonRows].sort((a, b) => {
      const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return right - left;
    })[0];
    const lastLessonId = existing?.lastLessonId && currentLessonIds.has(existing.lastLessonId)
      ? existing.lastLessonId
      : latestLessonRow?.lessonId || '';
    const lastPositionSeconds = latestLessonRow?.lessonId === lastLessonId
      ? latestLessonRow.lastPositionSeconds || 0
      : existing?.lastPositionSeconds || 0;

    if (
      existing &&
      existing.courseVersionId === context.courseVersionId &&
      existing.completedLessons === completedLessons &&
      existing.totalLessons === totalLessons &&
      existing.progressPercent === progressPercent &&
      existing.lastLessonId === lastLessonId
    ) {
      return existing.toObject();
    }

    return CourseProgress.findOneAndUpdate(
      { userId, courseId: context.courseId },
      {
        $set: {
          userId,
          courseId: context.courseId,
          courseVersionId: context.courseVersionId,
          completedLessons,
          totalLessons,
          progressPercent,
          lastLessonId,
          lastPositionSeconds,
          completedAt,
        },
        $setOnInsert: {
          startedAt: new Date(),
        },
      },
      { upsert: true, new: true, lean: true }
    );
  }

  private async ensureCurrentVersionLessonProgress(userId: string, context: CourseProgressContext) {
    for (const lesson of context.lessons) {
      const equivalentLessonIds = Array.from(new Set(lesson.equivalentLessonIds || []))
        .filter((lessonId) => lessonId && lessonId !== lesson.lessonId);
      if (equivalentLessonIds.length === 0) continue;

      const current = await LessonProgress.exists({
        userId,
        courseId: context.courseId,
        courseVersionId: context.courseVersionId,
        lessonId: lesson.lessonId,
      });
      if (current) continue;

      const source = await LessonProgress.findOne({
        userId,
        courseId: context.courseId,
        lessonId: { $in: equivalentLessonIds },
        courseVersionId: { $ne: context.courseVersionId },
      })
        .sort({ updatedAt: -1, completedAt: -1 })
        .lean();
      if (!source) continue;

      const durationSeconds = source.durationSeconds || lesson.duration || 0;
      const watchedSeconds = source.watchedSeconds || 0;
      const watchPercent = lesson.type === LessonProgressType.VIDEO && durationSeconds > 0
        ? Math.min(100, Math.round((watchedSeconds / durationSeconds) * 100))
        : source.watchPercent || 0;

      await LessonProgress.findOneAndUpdate(
        { userId, courseId: context.courseId, lessonId: lesson.lessonId },
        {
          $set: {
            userId,
            courseId: context.courseId,
            courseVersionId: context.courseVersionId,
            lessonId: lesson.lessonId,
            lessonType: lesson.type as LessonProgressType,
            status: source.status,
            watchedSeconds,
            watchedSegments: source.watchedSegments || [],
            durationSeconds,
            watchPercent,
            quizAttemptId: source.quizAttemptId || '',
            quizScore: source.quizScore || 0,
            quizPassed: Boolean(source.quizPassed),
            lastPositionSeconds: source.lastPositionSeconds || 0,
            completedAt: source.completedAt || null,
          },
          $setOnInsert: {
            createdAt: source.createdAt || new Date(),
          },
        },
        { upsert: true, new: true }
      );
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

  private async loadReadableContext(userId: string, userRole: string, courseId: string) {
    const context = await courseContextService.getContext({ userId, userRole, courseId });
    if (!context.allowed && context.reason !== 'OWNER_PREVIEW') {
      throw new Error(context.reason || 'Bạn không có quyền xem dữ liệu tiến độ khóa học này.');
    }
    return context;
  }

  private async assertLessonUnlocked(userId: string, context: CourseProgressContext, lessonId: string) {
    const completedRows = await LessonProgress.find({
      userId,
      courseId: context.courseId,
      courseVersionId: context.courseVersionId,
      status: LessonProgressStatus.COMPLETED,
    })
      .select('lessonId')
      .lean();
    const completedLessonIds = new Set(completedRows.map((row) => row.lessonId));
    const sortedLessons = this.sortLessons(context.lessons);
    const lessonIndex = sortedLessons.findIndex((lesson) => lesson.lessonId === lessonId);
    if (lessonIndex < 0) throw new Error('Bài học không thuộc khóa học hiện tại.');

    const access = this.resolveLessonAccess(
      sortedLessons[lessonIndex],
      lessonIndex,
      sortedLessons,
      completedLessonIds,
      context.progressionMode
    );
    if (access.locked) {
      throw new Error(access.reason || 'Bài học này đang bị khóa.');
    }
  }

  private sortLessons(lessons: CourseLessonContext[]) {
    return [...lessons].sort((a, b) => {
      if (a.sectionOrder !== b.sectionOrder) return a.sectionOrder - b.sectionOrder;
      if (a.sectionId !== b.sectionId) return a.sectionId.localeCompare(b.sectionId);
      if (a.order !== b.order) return a.order - b.order;
      return a.lessonId.localeCompare(b.lessonId);
    });
  }

  private resolveLessonAccess(
    lesson: CourseLessonContext,
    index: number,
    sortedLessons: CourseLessonContext[],
    completedLessonIds: Set<string>,
    progressionMode: ProgressionMode
  ): LessonAccessSummary {
    if (progressionMode === 'FREE' || lesson.required === false) {
      return { lessonId: lesson.lessonId, locked: false };
    }

    if (progressionMode === 'SEQUENTIAL') {
      const previousRequired = sortedLessons.slice(0, index).filter((item) => item.required !== false);
      const missing = previousRequired.filter((item) => !completedLessonIds.has(item.lessonId)).map((item) => item.lessonId);
      return {
        lessonId: lesson.lessonId,
        locked: missing.length > 0,
        reason: missing.length > 0 ? 'Hoàn thành bài trước để mở bài này.' : undefined,
        requiredLessonIds: missing,
      };
    }

    if (progressionMode === 'QUIZ_REQUIRES_PREVIOUS_LESSONS' && lesson.type === LessonProgressType.QUIZ) {
      const previousInSection = sortedLessons
        .slice(0, index)
        .filter((item) => item.sectionId === lesson.sectionId && item.required !== false);
      const missing = previousInSection
        .filter((item) => !completedLessonIds.has(item.lessonId))
        .map((item) => item.lessonId);
      return {
        lessonId: lesson.lessonId,
        locked: missing.length > 0,
        reason: missing.length > 0 ? 'Hoàn thành các bài trước trong phần này để mở quiz.' : undefined,
        requiredLessonIds: missing,
      };
    }

    return { lessonId: lesson.lessonId, locked: false };
  }

  private async recordDailyActivity(
    userId: string,
    activeSeconds: number,
    heartbeatCount: number,
    completedLessons: number,
    completedCourses: number
  ) {
    await LearnerActivityDaily.findOneAndUpdate(
      { userId, date: this.todayKey() },
      {
        $inc: {
          activeSeconds,
          heartbeatCount,
          completedLessons,
          completedCourses,
        },
      },
      { upsert: true, new: true }
    );
  }

  private calculateCurrentStreak(activeDaySet: Set<string>, startDateKey = this.todayKey()) {
    let streak = 0;
    let cursorKey = startDateKey;
    while (activeDaySet.has(cursorKey)) {
      streak++;
      cursorKey = this.addDaysKey(cursorKey, -1);
    }
    return streak;
  }

  private async getDailyActiveSeconds(userId: string, date: string) {
    const row = await LearnerActivityDaily.findOne({ userId, date }).select({ activeSeconds: 1 }).lean();
    return row?.activeSeconds || 0;
  }

  private todayKey() {
    return this.dateKey(new Date());
  }

  private dateKey(date: Date) {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: ACTIVITY_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value || '00';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  private addDaysKey(dateKey: string, days: number) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private percent(numerator: number, denominator: number) {
    return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
  }

  private average(values: number[]) {
    const valid = values.filter((value) => Number.isFinite(value));
    if (valid.length === 0) return 0;
    return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
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

