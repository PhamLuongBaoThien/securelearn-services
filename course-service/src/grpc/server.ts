import { GrpcStatus, createCourseGrpcServer, createGrpcError } from '@securelearn/common';
import { Course, CourseProgressionMode, CourseStatus } from '../models/course.model';
import { CourseVersion } from '../models/courseVersion.model';
import { Lesson } from '../models/lesson.model';
import { Section } from '../models/section.model';
import { Enrollment, EnrollmentStatus } from '../models/enrollment.model';
import subscriptionAccessService from '../services/subscriptionAccess.service';

export const createInternalGrpcServer = () =>
  createCourseGrpcServer({
    listCourseNotificationRecipients: async ({ courseId, page, limit }) => {
      if (!courseId) throw createGrpcError(GrpcStatus.INVALID_ARGUMENT, 'Thiếu courseId.');
      const safePage = Math.max(1, page || 1);
      const safeLimit = Math.min(200, Math.max(1, limit || 100));
      const filter = { courseId, status: EnrollmentStatus.ACTIVE };
      const [rows, total] = await Promise.all([
        Enrollment.find(filter).select('userId learnerEmail learnerName').sort({ _id: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
        Enrollment.countDocuments(filter),
      ]);
      return { recipients: rows.map(row => ({ userId: row.userId, email: row.learnerEmail || '', fullName: row.learnerName || 'Học viên', role: 'STUDENT' })), total, hasMore: safePage * safeLimit < total };
    },
    checkCourseEntitlement: async ({ userId, courseId }) => {
      const result = await subscriptionAccessService.entitlement(userId, courseId);
      return {
        allowed: result.allowed,
        source: 'source' in result ? result.source : undefined,
        reason: 'reason' in result ? result.reason : undefined,
        termId: 'termId' in result ? result.termId : undefined,
        accessEndsAt:
          'accessEndsAt' in result && result.accessEndsAt instanceof Date
            ? result.accessEndsAt.toISOString()
            : undefined,
      };
    },
    getCourseProgressContext: async ({ userId, userRole, courseId }) => {
      if (!userId || !userRole || !courseId) {
        throw createGrpcError(GrpcStatus.INVALID_ARGUMENT, 'Thiếu userId, userRole hoặc courseId.');
      }

      const course = await Course.findOne({
        _id: courseId,
        status: CourseStatus.PUBLISHED,
        currentVersionId: { $ne: null },
      }).lean();
      if (!course || !course.currentVersionId) {
        throw createGrpcError(GrpcStatus.NOT_FOUND, 'Khóa học không tồn tại hoặc chưa xuất bản.');
      }

      const isOwner = userRole === 'INSTRUCTOR' && String(course.instructorId) === userId;
      const access = isOwner
        ? { allowed: false, reason: 'OWNER_PREVIEW' }
        : await subscriptionAccessService.entitlement(userId, course._id.toString());

      const currentVersionId = course.currentVersionId.toString();
      const versionRows = await CourseVersion.find({ courseId: course._id }).select('_id').lean();
      const versionIds = versionRows.map((version) => version._id);
      const allVersionIds = versionIds.some((versionId) => versionId.toString() === currentVersionId)
        ? versionIds
        : [...versionIds, course.currentVersionId];
      const [lessons, sections, allLessons, allSections] = await Promise.all([
        Lesson.find({ courseId: course.currentVersionId })
          .sort({ order: 1, createdAt: 1 })
          .select('_id title type duration order sectionId sourceLessonId')
          .lean(),
        Section.find({ courseId: course.currentVersionId })
          .select('_id order')
          .lean(),
        Lesson.find({ courseId: { $in: allVersionIds } })
          .select('_id courseId sectionId sourceLessonId type order')
          .lean(),
        Section.find({ courseId: { $in: allVersionIds } })
          .select('_id courseId order')
          .lean(),
      ]);
      const sectionOrderById = new Map(sections.map((section) => [section._id.toString(), section.order || 0]));
      const allSectionOrderById = new Map(allSections.map((section) => [section._id.toString(), section.order || 0]));
      const equivalentIdsByIdentity = new Map<string, Set<string>>();
      const equivalentIdsByPosition = new Map<string, Set<string>>();

      for (const lesson of allLessons) {
        const lessonId = lesson._id.toString();
        const identityKey = `${lesson.type}:${(lesson.sourceLessonId || lesson._id).toString()}`;
        if (!equivalentIdsByIdentity.has(identityKey)) equivalentIdsByIdentity.set(identityKey, new Set());
        equivalentIdsByIdentity.get(identityKey)!.add(lessonId);

        const positionKey = [
          lesson.type,
          allSectionOrderById.get(lesson.sectionId.toString()) || 0,
          lesson.order,
        ].join(':');
        if (!equivalentIdsByPosition.has(positionKey)) equivalentIdsByPosition.set(positionKey, new Set());
        equivalentIdsByPosition.get(positionKey)!.add(lessonId);
      }

      return {
        allowed: Boolean(access.allowed),
        reason: access.allowed ? undefined : access.reason || 'NOT_ENTITLED',
        courseId: course._id.toString(),
        courseVersionId: currentVersionId,
        totalLessons: lessons.length,
        progressionMode: course.progressionMode || CourseProgressionMode.FREE,
        instructorId: String(course.instructorId || ''),
        lessons: lessons.map((lesson) => {
          const lessonId = lesson._id.toString();
          const sectionOrder = sectionOrderById.get(lesson.sectionId.toString()) || 0;
          const identityKey = `${lesson.type}:${(lesson.sourceLessonId || lesson._id).toString()}`;
          const positionKey = [lesson.type, sectionOrder, lesson.order].join(':');
          const equivalentLessonIds = new Set<string>(equivalentIdsByIdentity.get(identityKey) || []);
          if (!lesson.sourceLessonId) {
            for (const equivalentId of equivalentIdsByPosition.get(positionKey) || []) {
              equivalentLessonIds.add(equivalentId);
            }
          }

          return {
            lessonId,
            title: lesson.title,
            type: lesson.type,
            duration: lesson.duration || 0,
            order: lesson.order,
            sectionId: lesson.sectionId.toString(),
            sectionOrder,
            required: true,
            equivalentLessonIds: Array.from(equivalentLessonIds).filter((id) => id !== lessonId),
          };
        }),
      };
    },
  });
