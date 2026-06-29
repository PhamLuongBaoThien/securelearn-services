import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { SessionDeviceType } from '../models/authSession.model';

export interface SessionMetadata {
  userAgent: string;
  deviceType: SessionDeviceType;
  deviceName: string;
  browser: string;
  operatingSystem: string;
  ipAddress: string;
}

const UNKNOWN = 'Không xác định';

export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const refreshTokenMatches = (token: string, expectedHash: string): boolean => {
  const actual = Buffer.from(hashRefreshToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const browserFromUserAgent = (userAgent: string): string => {
  const matchers: Array<[RegExp, string]> = [
    [/Edg\//, 'Microsoft Edge'],
    [/OPR\//, 'Opera'],
    [/Chrome\//, 'Chrome'],
    [/Firefox\//, 'Firefox'],
    [/Version\/.*Safari/, 'Safari'],
  ];
  for (const [pattern, name] of matchers) {
    if (pattern.test(userAgent)) return name;
  }
  return UNKNOWN;
};

const osFromUserAgent = (userAgent: string): string => {
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Android/.test(userAgent)) return 'Android';
  if (/iPhone OS|CPU OS|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Mac OS X/.test(userAgent)) return 'macOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return UNKNOWN;
};

const deviceTypeFromUserAgent = (userAgent: string): SessionDeviceType => {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
  if (/Mobile|iPhone|Android/i.test(userAgent)) return 'mobile';
  if (/Windows|Macintosh|Linux/i.test(userAgent)) return 'desktop';
  return 'unknown';
};

const deviceLabel = (type: SessionDeviceType, userAgent: string): string => {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return type === 'tablet' ? 'Máy tính bảng Android' : 'Điện thoại Android';
  if (/Windows/i.test(userAgent)) return 'Máy tính Windows';
  if (/Macintosh/i.test(userAgent)) return 'Máy Mac';
  if (/Linux/i.test(userAgent)) return 'Máy tính Linux';
  return type === 'mobile' ? 'Điện thoại' : type === 'tablet' ? 'Máy tính bảng' : 'Thiết bị không xác định';
};

export const parseSessionMetadata = (userAgentValue?: string, ipAddress?: string): SessionMetadata => {
  const userAgent = String(userAgentValue || '').trim().slice(0, 512) || UNKNOWN;
  const deviceType = deviceTypeFromUserAgent(userAgent);
  const browser = browserFromUserAgent(userAgent);
  const operatingSystem = osFromUserAgent(userAgent);
  const device = deviceLabel(deviceType, userAgent);
  return {
    userAgent,
    deviceType,
    deviceName: browser === UNKNOWN || operatingSystem === UNKNOWN ? device : `${browser.replace(/\s+\d+$/, '')} trên ${operatingSystem}`,
    browser,
    operatingSystem,
    ipAddress: String(ipAddress || '').trim().slice(0, 64) || UNKNOWN,
  };
};

export const getSessionMetadata = (req: Request): SessionMetadata => parseSessionMetadata(req.get('user-agent'), req.ip);
