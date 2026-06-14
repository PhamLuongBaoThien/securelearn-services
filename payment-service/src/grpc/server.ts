import { createPaymentGrpcServer } from '@securelearn/common';
import subscriptionService from '../services/subscription.service';

export const createInternalGrpcServer = () =>
  createPaymentGrpcServer({
    recordSubscriptionUsage: async (request) => subscriptionService.recordUsage(request),
  });
