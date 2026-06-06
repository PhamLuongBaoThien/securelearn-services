// Payment Event Publishers
// Mục đích:
// - phát event thanh toán thành công/thất bại sang RabbitMQ
// - cho course-service và các service khác consume
// Hàm chính:
// - publishPaymentCourseSucceeded()
// - publishPaymentCourseFailed()

import {
  publishMessage,
  Exchange,
  RoutingKey,
  type PaymentCourseSucceededPayload,
  type PaymentCourseFailedPayload,
} from '@securelearn/common';

export const publishPaymentCourseSucceeded = async (payload: PaymentCourseSucceededPayload): Promise<void> => {
  await publishMessage(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_SUCCEEDED, payload);
};

export const publishPaymentCourseFailed = async (payload: PaymentCourseFailedPayload): Promise<void> => {
  await publishMessage(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_FAILED, payload);
};
