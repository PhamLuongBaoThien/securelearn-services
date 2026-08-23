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
  videoAssetId: string;
};

export type CourseProgressContext = {
  allowed: boolean;
  reason?: string;
  courseId: string;
  courseTitle: string;
  courseVersionId: string;
  totalLessons: number;
  progressionMode: ProgressionMode;
  instructorId: string;
  accessSource: 'PURCHASE' | 'SUBSCRIPTION' | '';
  subscriptionTermId: string;
  accessEndsAt?: string;
  lessons: CourseLessonContext[];
};

/**
 * [BƯỚC 3: DỊCH VỤ COURSE CONTEXT - BACKEND]
 * Lớp này chịu trách nhiệm giao tiếp liên dịch vụ (Inter-service communication) bằng gRPC
 * để đồng bộ thông tin giáo trình và quyền hạn của học viên từ course-service sang progress-service.
 */
class CourseContextService {
  /**
   * Hàm: getContext
   * Vai trò: Truy vấn cấu trúc giáo trình khóa học và kiểm tra quyền sở hữu/đăng ký của học viên từ course-service.
   * Cách thức hoạt động:
   *  - Sử dụng gRPC client (`courseGrpcClient.getCourseProgressContext`) để gửi request nhanh chóng mặt (hiệu năng cao hơn HTTP).
   *  - Nhận về metadata của khóa học gồm: progressionMode (FREE - học tự do, SEQUENTIAL - học tuần tự, QUIZ_REQUIRES_PREVIOUS_LESSONS - quiz yêu cầu học xong các bài trước).
   *  - Nhận về danh sách toàn bộ các lesson cùng thuộc tính: required (bắt buộc hay không), equivalentLessonIds (các ID tương đương ở phiên bản cũ).
   * Khi nào sử dụng: Gọi mỗi khi có heartbeat gửi lên, hoặc khi học viên yêu cầu lấy tiến độ khóa học, lấy trạng thái mở khóa.
   *  Điều này đảm bảo progress-service luôn có cấu trúc bài học mới nhất của khóa học mà không cần lưu trữ dư thừa bản sao giáo trình trong DB của nó.
   */
  /**
   * [FLOW HỌC VIDEO - PROGRESS.2: LẤY COURSE CONTEXT]
   * Được gọi bởi: acquire, heartbeat, getCourseProgress và getCourseAccess.
   * Mục đích: gọi Course Service qua gRPC để lấy nguồn sự thật về entitlement, phiên bản và lesson/video binding.
   */
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
      accessSource: (context.accessSource || '') as CourseProgressContext['accessSource'],
      subscriptionTermId: context.subscriptionTermId || '',
      accessEndsAt: context.accessEndsAt || undefined,
      courseTitle: context.courseTitle || '',
      lessons: context.lessons.map((lesson) => ({
        ...lesson,
        type: lesson.type as CourseLessonContext['type'],
        sectionOrder: lesson.sectionOrder || 0,
        required: lesson.required !== false,
        equivalentLessonIds: lesson.equivalentLessonIds || [],
        videoAssetId: lesson.videoAssetId || '',
      })),
    };
  }
}

export default new CourseContextService();
