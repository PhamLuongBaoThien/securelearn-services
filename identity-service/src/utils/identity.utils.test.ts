/**
 * Kiểm tra nhanh quy tắc chuẩn hoá email, số điện thoại và điều kiện hồ sơ giảng viên.
 * File được chạy bởi npm test sau khi TypeScript build thành công.
 */
import assert from 'node:assert/strict';
import { buildPublicSlugCandidate, normalizeEmail, normalizePublicSlugBase, normalizeVietnamPhone } from './identity.utils';
import { getMissingInstructorFields } from '../validators/profile-completeness';

assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
assert.equal(normalizeVietnamPhone('+84912345678'), '0912345678');
assert.equal(normalizeVietnamPhone('0912 345 678'), '0912345678');
assert.throws(() => normalizeVietnamPhone('123'));
assert.equal(normalizePublicSlugBase(' Nguyễn Văn An '), 'nguyen-van-an');
assert.equal(normalizePublicSlugBase('ĐẶNG Thị Hồng!'), 'dang-thi-hong');
assert.equal(normalizePublicSlugBase('---'), 'nguoi-dung');
assert.equal(buildPublicSlugCandidate('nguyen-van-an', 1), 'nguyen-van-an');
assert.equal(buildPublicSlugCandidate('nguyen-van-an', 2), 'nguyen-van-an-2');
assert.equal(buildPublicSlugCandidate('nguyen-van-an', 3), 'nguyen-van-an-3');
assert.deepEqual(getMissingInstructorFields({}), ['fullName', 'email', 'phone', 'avatar', 'headline', 'bio']);
assert.deepEqual(getMissingInstructorFields({ fullName: 'A', email: 'a@b.vn', emailVerifiedAt: new Date(), phone: '0912345678', profile: { avatarUrl: 'x', headline: 'Expert', bio: 'Bio' } }), []);
console.log('identity utility tests passed');
