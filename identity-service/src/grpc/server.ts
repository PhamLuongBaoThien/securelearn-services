import { GrpcStatus, createGrpcError, createIdentityGrpcServer } from '@securelearn/common';
import authService from '../services/auth.service';
import { User } from '../models/user.model';
import { Admin } from '../models/admin.model';
import { RolePermission } from '../models/rolePermission.model';

export const createInternalGrpcServer = () => createIdentityGrpcServer({
  checkInstructorProfile: async (userId) => {
    if (!userId) throw createGrpcError(GrpcStatus.INVALID_ARGUMENT, 'Thiếu userId.');
    return authService.checkInstructorProfile(userId);
  },
  listNotificationRecipients: async (request) => {
    const page = Math.max(1, request.page || 1);
    const limit = Math.min(200, Math.max(1, request.limit || 100));
    const skip = (page - 1) * limit;

    if (request.recipientType === 'ADMIN') {
      const filter: Record<string, unknown> = { status: 'ACTIVE' };
      if (request.userId) filter._id = request.userId;
      if (request.email) filter.email = request.email.trim().toLowerCase();
      if (request.permission) {
        const roles = await RolePermission.find({ permissions: request.permission }).distinct('roleKey');
        if (!roles.includes('SUPER_ADMIN')) roles.push('SUPER_ADMIN');
        filter.adminRole = { $in: roles };
      }
      const [admins, total] = await Promise.all([
        Admin.find(filter).select('_id email fullName adminRole').sort({ _id: 1 }).skip(skip).limit(limit).lean(),
        Admin.countDocuments(filter),
      ]);
      return {
        recipients: admins.map(admin => ({ userId: admin._id.toString(), email: admin.email, fullName: admin.fullName, role: 'ADMIN' })),
        total,
        hasMore: page * limit < total,
      };
    }

    const filter: Record<string, unknown> = { isLocked: false };
    if (request.userId) filter._id = request.userId;
    else if (request.email) filter.email = request.email.trim().toLowerCase();
    else if (request.audience === 'ALL_LEARNERS') filter.role = { $in: ['STUDENT', 'INSTRUCTOR'] };
    else if (request.audience === 'ALL_INSTRUCTORS') filter.role = 'INSTRUCTOR';
    const [users, total] = await Promise.all([
      User.find(filter).select('_id email fullName role').sort({ _id: 1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    return {
      recipients: users.map(user => ({ userId: user._id.toString(), email: user.email, fullName: user.fullName, role: user.role })),
      total,
      hasMore: page * limit < total,
    };
  },
});