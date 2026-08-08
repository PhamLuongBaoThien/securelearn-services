import assert from 'node:assert/strict';
import {
  getRequiredPermissions,
  normalizePermissionDependencies,
} from './permission.utils';

assert.deepEqual(
  normalizePermissionDependencies(['course:update', 'course:read', 'course:approve']),
  ['course:update', 'course:read', 'course:approve'],
);

assert.deepEqual(
  normalizePermissionDependencies([
    'course:update',
    'course:delete',
    'user:lock',
    'finance:manage',
    'notif:manage',
    'inbox:manage',
    'system:config',
  ]),
  ['inbox:manage', 'system:config'],
);

assert.deepEqual(
  normalizePermissionDependencies(['finance:read', 'finance:manage', 'finance:manage']),
  ['finance:read', 'finance:manage'],
);

assert.deepEqual(getRequiredPermissions('notif:manage'), ['notif:manage', 'notif:read']);
assert.deepEqual(getRequiredPermissions('inbox:manage'), ['inbox:manage']);

console.log('Permission dependency tests passed');
