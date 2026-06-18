import { GrpcStatus, createCourseGrpcServer, createGrpcError } from '@securelearn/common';
import { Course, CourseStatus } from '../models/course.model';
import { Lesson } from '../models/lesson.model';
import subscriptionAccessService from '../services/subscriptionAccess.service';

export const createInternalGrpcServer = () =>
  createCourseGrpcServer({
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

      const lessons = await Lesson.find({ courseId: course.currentVersionId })
        .sort({ order: 1, createdAt: 1 })
        .select('_id title type duration order sectionId')
        .lean();

      return {
        allowed: Boolean(access.allowed),
        reason: access.allowed ? undefined : access.reason || 'NOT_ENTITLED',
        courseId: course._id.toString(),
        courseVersionId: course.currentVersionId.toString(),
        totalLessons: lessons.length,
        lessons: lessons.map((lesson) => ({
          lessonId: lesson._id.toString(),
          title: lesson.title,
          type: lesson.type,
          duration: lesson.duration || 0,
          order: lesson.order,
          sectionId: lesson.sectionId.toString(),
        })),
      };
    },
  });
