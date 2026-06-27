import { GrpcStatus, createGrpcError, createIdentityGrpcServer } from '@securelearn/common';
import authService from '../services/auth.service';

export const createInternalGrpcServer = () => createIdentityGrpcServer({
  checkInstructorProfile: async (userId) => {
    if (!userId) throw createGrpcError(GrpcStatus.INVALID_ARGUMENT, 'Thiếu userId.');
    return authService.checkInstructorProfile(userId);
  },
});