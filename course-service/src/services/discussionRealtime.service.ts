import http from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import redisClient from '../config/redis';
import { Course } from '../models/course.model';
import { Lesson } from '../models/lesson.model';
import subscriptionAccessService from './subscriptionAccess.service';
import { verifyCourseSocketToken, type CourseSocketIdentity } from './discussionAuth.service';

let io: Server | null = null;
let pubClient: ReturnType<typeof redisClient.duplicate> | null = null;
let subClient: ReturnType<typeof redisClient.duplicate> | null = null;
let ready = false;

const courseRoom = (courseId: string) => `COURSE:DISCUSSION:${courseId}`;
const lessonRoom = (courseId: string, lessonId: string) =>
  `COURSE:DISCUSSION:${courseId}:${lessonId}`;

async function canAccess(identity: CourseSocketIdentity, courseId: string, lessonId: string) {
  const course = await Course.findById(courseId).select('instructorId currentVersionId').lean();
  if (!course?.currentVersionId) return false;
  const lessonExists = await Lesson.exists({ _id: lessonId, courseId: course.currentVersionId });
  if (!lessonExists) return false;
  if (identity.role === 'INSTRUCTOR' && course.instructorId === identity.id) return true;
  return (await subscriptionAccessService.entitlement(identity.id, courseId)).allowed;
}

export async function initializeDiscussionRealtime(server: http.Server) {
  io = new Server(server, {
    path: '/course.socket.io',
    cors: {
      origin: (process.env.SOCKET_CORS_ORIGIN || process.env.CLIENT_URL || 'http://localhost:5173').split(','),
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token || socket.handshake.headers.authorization;
      socket.data.identity = await verifyCourseSocketToken(String(raw || '').replace(/^Bearer\s+/i, ''));
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Unauthorized'));
    }
  });

  io.on('connection', socket => {
    const identity = socket.data.identity as CourseSocketIdentity;
    socket.on('discussion:subscribe', async ({ courseId, lessonId } = {}, ack?: (result: unknown) => void) => {
      try {
        if (!courseId || !lessonId || !(await canAccess(identity, String(courseId), String(lessonId)))) {
          throw new Error('Bạn không có quyền truy cập thảo luận này.');
        }
        await socket.join(courseRoom(String(courseId)));
        await socket.join(lessonRoom(String(courseId), String(lessonId)));
        ack?.({ status: 'OK' });
      } catch (error) {
        ack?.({ status: 'ERR', message: error instanceof Error ? error.message : 'Không thể đăng ký thảo luận.' });
      }
    });
    socket.on('discussion:subscribe-course', async ({ courseId } = {}, ack?: (result: unknown) => void) => {
      try {
        const course = await Course.findById(String(courseId || '')).select('instructorId').lean();
        if (!course || identity.role !== 'INSTRUCTOR' || course.instructorId !== identity.id) {
          throw new Error('Chỉ chủ khóa học được theo dõi toàn bộ thảo luận.');
        }
        await socket.join(courseRoom(String(courseId)));
        ack?.({ status: 'OK' });
      } catch (error) {
        ack?.({ status: 'ERR', message: error instanceof Error ? error.message : 'Không thể đăng ký khóa học.' });
      }
    });    socket.on('discussion:unsubscribe', ({ courseId, lessonId } = {}) => {
      if (courseId) void socket.leave(courseRoom(String(courseId)));
      if (courseId && lessonId) void socket.leave(lessonRoom(String(courseId), String(lessonId)));
    });
  });

  try {
    pubClient = redisClient.duplicate();
    subClient = redisClient.duplicate();
    await Promise.race([
      Promise.all([pubClient.ping(), subClient.ping()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis adapter timeout')), 3000)),
    ]);
    io.adapter(createAdapter(pubClient, subClient));
    ready = true;
  } catch (error) {
    ready = false;
    pubClient?.disconnect();
    subClient?.disconnect();
    console.error(JSON.stringify({ event: 'course_discussion_realtime_degraded', error: error instanceof Error ? error.message : String(error) }));
  }
}

export const discussionRealtimeReady = () => ready;
export const emitDiscussionCreated = (courseId: string, lessonId: string, payload: unknown) =>
  io?.to(lessonRoom(courseId, lessonId)).to(courseRoom(courseId)).emit('discussion:created', payload);
export const emitDiscussionUpdated = (courseId: string, lessonId: string, payload: unknown) =>
  io?.to(lessonRoom(courseId, lessonId)).to(courseRoom(courseId)).emit('discussion:updated', payload);
export const emitDiscussionDeleted = (courseId: string, lessonId: string, payload: unknown) =>
  io?.to(lessonRoom(courseId, lessonId)).to(courseRoom(courseId)).emit('discussion:deleted', payload);
export const emitDiscussionHidden = (courseId: string, lessonId: string, payload: unknown) => {
  io?.to(lessonRoom(courseId, lessonId)).to(courseRoom(courseId)).emit('discussion:hidden', payload);
};

export async function shutdownDiscussionRealtime() {
  ready = false;
  await new Promise<void>(resolve => io ? io.close(() => resolve()) : resolve());
  await Promise.allSettled([pubClient?.quit(), subClient?.quit()]);
  io = null;
}


