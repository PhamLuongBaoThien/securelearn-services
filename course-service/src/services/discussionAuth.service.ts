import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';

export type CourseSocketIdentity = {
  id: string;
  role: 'STUDENT' | 'INSTRUCTOR';
  name: string;
  sid?: string;
};

export async function verifyCourseSocketToken(token?: string): Promise<CourseSocketIdentity> {
  if (!token || !process.env.ACCESS_TOKEN) throw new Error('Token không hợp lệ.');
  const payload = jwt.verify(token, process.env.ACCESS_TOKEN) as jwt.JwtPayload;
  if (!payload.id || !['STUDENT', 'INSTRUCTOR'].includes(String(payload.role))) {
    throw new Error('Bạn không có quyền sử dụng thảo luận.');
  }
  if (!payload.sid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (redisClient.status === 'ready') {
    const [locked, revoked] = await redisClient.mget(
      `locked_user:${payload.id}`,
      `revoked_session:${payload.sid}`,
    );
    if (locked || revoked) throw new Error('Phiên đăng nhập không còn hợp lệ.');
  }
  return {
    id: String(payload.id),
    role: String(payload.role) as CourseSocketIdentity['role'],
    name: String(payload.fullName || payload.name || ''),
    sid: String(payload.sid),
  };
}
