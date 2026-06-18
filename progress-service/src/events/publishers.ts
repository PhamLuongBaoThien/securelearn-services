import {
  Exchange,
  RoutingKey,
  publishMessage,
  type ProgressCourseCompletedPayload,
  type ProgressLessonCompletedPayload,
} from '@securelearn/common';

const safePublish = async <T>(routingKey: RoutingKey, payload: T): Promise<void> => {
  try {
    await publishMessage(Exchange.PROGRESS, routingKey, payload);
  } catch (error) {
    console.error(`[ProgressEvent] Failed to publish ${routingKey}:`, error);
  }
};

export const publishLessonCompleted = async (payload: ProgressLessonCompletedPayload): Promise<void> => {
  await safePublish(RoutingKey.PROGRESS_LESSON_COMPLETED, payload);
};

export const publishCourseCompleted = async (payload: ProgressCourseCompletedPayload): Promise<void> => {
  await safePublish(RoutingKey.PROGRESS_COURSE_COMPLETED, payload);
};
