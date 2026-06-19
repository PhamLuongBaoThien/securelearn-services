import { courseGrpcClient } from '../grpc/course.client';

export type ProgressionMode = 'FREE' | 'SEQUENTIAL' | 'QUIZ_REQUIRES_PREVIOUS_LESSONS';

export type CourseLessonContext = {
  lessonId: string;
  title: string;
  type: 'VIDEO' | 'QUIZ';
  duration: number;
  order: number;
  sectionId: string;
  sectionOrder: number;
  required: boolean;
  equivalentLessonIds: string[];
};

export type CourseProgressContext = {
  allowed: boolean;
  reason?: string;
  courseId: string;
  courseVersionId: string;
  totalLessons: number;
  progressionMode: ProgressionMode;
  instructorId: string;
  lessons: CourseLessonContext[];
};

class CourseContextService {
  public async getContext(input: {
    courseId: string;
    userId: string;
    userRole: string;
  }): Promise<CourseProgressContext> {
    const context = await courseGrpcClient.getCourseProgressContext({
      userId: input.userId,
      userRole: input.userRole,
      courseId: input.courseId,
    });
    if (!context.courseId || !context.courseVersionId) {
      throw new Error('Course-service không trả dữ liệu context tiến độ.');
    }

    return {
      ...context,
      progressionMode: (context.progressionMode || 'FREE') as ProgressionMode,
      instructorId: context.instructorId || '',
      lessons: context.lessons.map((lesson) => ({
        ...lesson,
        type: lesson.type as CourseLessonContext['type'],
        sectionOrder: lesson.sectionOrder || 0,
        required: lesson.required !== false,
        equivalentLessonIds: lesson.equivalentLessonIds || [],
      })),
    };
  }
}

export default new CourseContextService();
