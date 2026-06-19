import {
  Exchange,
  RoutingKey,
  subscribeMessage,
  type CourseVersionPublishedPayload,
} from '@securelearn/common';
import progressService from '../services/progress.service';

export const registerEventHandlers = async (): Promise<void> => {
  await subscribeMessage<CourseVersionPublishedPayload>(
    Exchange.COURSE,
    RoutingKey.COURSE_VERSION_PUBLISHED,
    'progress-service.course-version-published',
    async (payload) => {
      await progressService.migrateCourseVersionProgress(payload);
    }
  );
};
