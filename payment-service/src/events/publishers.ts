// ========================
// Payment Event Publishers
// Mục đích:
// - phát event payment và subscription sang RabbitMQ
// - giúp course-service, identity-service và các service khác đồng bộ quyền học, finance và projection UI
// ========================
import {
  publishMessage,
  Exchange,
  RoutingKey,
  type PaymentCourseSucceededPayload,
  type PaymentCourseFailedPayload,
  type SubscriptionSettlementAvailablePayload,
} from '@securelearn/common';

type SubscriptionTermChangedPayload = {
  termId: string;
  userId: string;
  planId: string;
  planType: 'MONTHLY' | 'YEARLY';
  status: 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  startsAt: string;
  endsAt: string;
  transactionCode: string;
};

export const publishPaymentCourseSucceeded = async (payload: PaymentCourseSucceededPayload): Promise<void> => {
  await publishMessage(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_SUCCEEDED, payload);
};

export const publishPaymentCourseFailed = async (payload: PaymentCourseFailedPayload): Promise<void> => {
  await publishMessage(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_FAILED, payload);
};

export const publishSubscriptionTermChanged = async (payload: SubscriptionTermChangedPayload): Promise<void> => {
  // Event này là nguồn đồng bộ cho course-service và identity-service khi term đổi trạng thái.
  await publishMessage(Exchange.PAYMENT, 'payment.subscription.term-changed' as RoutingKey, payload);
};

export const publishSubscriptionSettlementAvailable = async (payload: SubscriptionSettlementAvailablePayload): Promise<void> => {
  await publishMessage(Exchange.PAYMENT, RoutingKey.SUBSCRIPTION_SETTLEMENT_AVAILABLE, payload);
};
