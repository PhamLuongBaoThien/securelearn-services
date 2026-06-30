import { GrpcStatus, createGrpcError, createIdentityGrpcServer } from '@securelearn/common';
import authService from '../services/auth.service';
import { User } from '../models/user.model';

export const createInternalGrpcServer = () => createIdentityGrpcServer({
  checkInstructorProfile: async (userId) => {
    if (!userId) throw createGrpcError(GrpcStatus.INVALID_ARGUMENT, 'Thiếu userId.');
    return authService.checkInstructorProfile(userId);
  },
  listNotificationRecipients: async (request) => {
    const page = Math.max(1, request.page || 1);
    const limit = Math.min(200, Math.max(1, request.limit || 100));
    const filter: Record<string, unknown> = { isLocked: false };
    if (request.userId) filter._id = request.userId;
    else if (request.email) filter.email = request.email.trim().toLowerCase();
    else if (request.audience === 'ALL_STUDENTS') filter.role = 'STUDENT';
    else if (request.audience === 'ALL_INSTRUCTORS') filter.role = 'INSTRUCTOR';
    const [users, total] = await Promise.all([User.find(filter).select('_id email fullName role').sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
    return { recipients: users.map(user => ({ userId: user._id.toString(), email: user.email, fullName: user.fullName, role: user.role })), total, hasMore: page * limit < total };
  },
});