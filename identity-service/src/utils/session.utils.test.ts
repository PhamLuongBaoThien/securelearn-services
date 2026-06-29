import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { AuthSession } from '../models/authSession.model';
import { generalAccessToken, generalRefreshToken, refreshTokenJwtService } from '../services/jwt.service';
import { hashRefreshToken, parseSessionMetadata, refreshTokenMatches } from './session.utils';

process.env.ACCESS_TOKEN = 'session-test-access-secret';
process.env.REFRESH_TOKEN = 'session-test-refresh-secret';

const chrome = parseSessionMetadata(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
  '203.0.113.10',
);
assert.equal(chrome.deviceType, 'desktop');
assert.equal(chrome.browser, 'Chrome');
assert.equal(chrome.operatingSystem, 'Windows');
assert.equal(chrome.deviceName, 'Chrome trên Windows');
assert.equal(chrome.ipAddress, '203.0.113.10');

const iphone = parseSessionMetadata(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1',
);
assert.equal(iphone.deviceType, 'mobile');
assert.equal(iphone.browser, 'Safari');
assert.equal(iphone.operatingSystem, 'iOS');

const unknown = parseSessionMetadata();
assert.equal(unknown.deviceType, 'unknown');
assert.equal(unknown.ipAddress, 'Không xác định');

const indexes = AuthSession.schema.indexes();
assert.equal(indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0), true);
assert.equal(indexes.some(([fields, options]) => fields.sessionId === 1 && options.unique === true), true);

const rawToken = 'high-entropy-refresh-token';
assert.equal(hashRefreshToken(rawToken).length, 64);
assert.equal(refreshTokenMatches(rawToken, hashRefreshToken(rawToken)), true);
assert.equal(refreshTokenMatches(`${rawToken}-reused`, hashRefreshToken(rawToken)), false);

const runJwtAssertions = async () => {
const sid = '8e0cbda3-98f3-4b48-a890-a236786a5317';
const refreshToken = generalRefreshToken({ id: 'user-1', role: 'STUDENT', sid });
const refreshResult = await refreshTokenJwtService(refreshToken);
assert.equal(refreshResult.status, 'OK');
assert.equal(refreshResult.decoded?.sid, sid);
const legacyResult = await refreshTokenJwtService(generalRefreshToken({ id: 'legacy-user', role: 'STUDENT' }));
assert.equal(legacyResult.decoded?.sid, undefined);

const accessToken = generalAccessToken({ id: 'user-1', role: 'STUDENT', fullName: 'Test User', sid });
assert.equal((jwt.decode(accessToken) as { sid?: string }).sid, sid);

};

runJwtAssertions()
  .then(() => console.log('session utility tests passed'))
  .catch((error) => { console.error(error); process.exitCode = 1; });