export const ALL_PERMISSIONS = [
  'course:read', 'course:update', 'course:delete', 'course:approve',
  'user:read', 'user:lock',
  'finance:read', 'finance:manage',
  'notif:read', 'notif:manage', 'inbox:manage',
  'system:config', 'system:rbac',
] as const;

export type PermissionId = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_PREREQUISITES: Partial<Record<PermissionId, PermissionId>> = {
  'course:update': 'course:read',
  'course:delete': 'course:read',
  'course:approve': 'course:read',
  'user:lock': 'user:read',
  'finance:manage': 'finance:read',
  'notif:manage': 'notif:read',
};

export const normalizePermissionDependencies = (permissions: readonly string[]): string[] => {
  const uniquePermissions = [...new Set(permissions)];
  return uniquePermissions.filter((permissionId) => {
    const prerequisite = PERMISSION_PREREQUISITES[permissionId as PermissionId];
    return !prerequisite || uniquePermissions.includes(prerequisite);
  });
};

export const getRequiredPermissions = (permissionId: string): string[] => {
  const prerequisite = PERMISSION_PREREQUISITES[permissionId as PermissionId];
  return prerequisite ? [permissionId, prerequisite] : [permissionId];
};
