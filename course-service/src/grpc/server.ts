import { createCourseGrpcServer } from '@securelearn/common';
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
  });
