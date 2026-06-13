// ========================
// Identity Event Handlers
// Mục đích:
// - nghe event term thuê bao từ payment-service
// - đồng bộ subscriptionStatus ở identity-service như một projection để hiển thị UI nhanh
// ========================
import { Exchange, RoutingKey, subscribeMessage } from '@securelearn/common';
import { SubscriptionStatus, User } from '../models/user.model';

type SubscriptionTermChangedPayload = {
  userId: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  startsAt: string;
  endsAt: string;
};

export const registerEventHandlers = async () => {
  await subscribeMessage<SubscriptionTermChangedPayload>(
    Exchange.PAYMENT,
    'payment.subscription.term-changed' as RoutingKey,
    'identity-service.subscription-term-changed',
    async (payload) => {
      if (payload.status === 'ACTIVE') {
        await User.updateOne({ _id: payload.userId }, { $set: { subscriptionStatus: SubscriptionStatus.ACTIVE } });
        return;
      }
      const now = Date.now();
      const affectedCurrentAccess = new Date(payload.startsAt).getTime() <= now;
      if (payload.status !== 'SCHEDULED' && affectedCurrentAccess) {
        await User.updateOne({ _id: payload.userId }, { $set: { subscriptionStatus: SubscriptionStatus.INACTIVE } });
      }
    }
  );
};
