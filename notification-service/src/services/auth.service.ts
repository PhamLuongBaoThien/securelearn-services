import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';

export interface AccessIdentity {
  id: string;
  role: string;
  sid?: string;
}

export const verifyAccessToken = async (token?: string): Promise<AccessIdentity> => {
  if (!token || !process.env.ACCESS_TOKEN) throw new Error('Token không hợp lệ.');
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN) as jwt.JwtPayload;
  if (!decoded.id || !decoded.role) throw new Error('Token không hợp lệ.');

  if (decoded.role !== 'ADMIN') {
    const keys = [`locked_user:${decoded.id}`];
    if (decoded.sid) keys.push(`revoked_session:${decoded.sid}`);
    const states = await redisClient.mget(...keys);
    if (states[0]) throw new Error('Tài khoản đã bị khóa.');
    if (decoded.sid && states[1]) throw new Error('Phiên đăng nhập đã bị thu hồi.');
  }

  return { id: String(decoded.id), role: String(decoded.role), sid: decoded.sid ? String(decoded.sid) : undefined };
};