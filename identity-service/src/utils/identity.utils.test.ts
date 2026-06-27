/**
 * Kiểm tra nhanh quy tắc chuẩn hoá email, số điện thoại và điều kiện hồ sơ giảng viên.
 * File được chạy bởi npm test sau khi TypeScript build thành công.
 */
import assert from 'node:assert/strict';
import { normalizeEmail, normalizeVietnamPhone } from './identity.utils';
import { getMissingInstructorFields } from '../validators/profile-completeness';

assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
assert.equal(normalizeVietnamPhone('+84912345678'), '0912345678');
assert.equal(normalizeVietnamPhone('0912 345 678'), '0912345678');
assert.throws(() => normalizeVietnamPhone('123'));
assert.deepEqual(getMissingInstructorFields({}), ['fullName', 'email', 'phone', 'avatar', 'headline', 'bio']);
assert.deepEqual(getMissingInstructorFields({ fullName: 'A', email: 'a@b.vn', emailVerifiedAt: new Date(), phone: '0912345678', profile: { avatarUrl: 'x', headline: 'Expert', bio: 'Bio' } }), []);
console.log('identity utility tests passed');
