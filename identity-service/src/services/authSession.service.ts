import { randomUUID } from 'crypto';
import { AuthSession, IAuthSession } from '../models/authSession.model';
import redisClient from '../config/redis';
import { generalRefreshToken } from './jwt.service';
import { hashRefreshToken, SessionMetadata } from '../utils/session.utils';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;

type SessionTokenPayload = { id: string; role: string; sid: string };

class AuthSessionService {
  private async blacklist(sessionId: string): Promise<void> {
    await redisClient.set(`revoked_session:${sessionId}`, '1', 'EX', ACCESS_TOKEN_TTL_SECONDS);
  }

  private async revokeRecord(session: IAuthSession, reason: string): Promise<void> {
    if (!session.revokedAt) {
      session.revokedAt = new Date();
      session.revokeReason = reason;
      await session.save();
    }
    await this.blacklist(session.sessionId);
  }

  public async createSession(userId: string, role: string, metadata: SessionMetadata) {
    const sessionId = randomUUID();
    const refreshToken = generalRefreshToken({ id: userId, role, sid: sessionId });
    const now = new Date();
    await AuthSession.create({
      sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      ...metadata,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });
    return { sessionId, refreshToken };
  }

  public async rotateSession(rawToken: string, payload: SessionTokenPayload, metadata: SessionMetadata) {
    const now = new Date();
    const refreshToken = generalRefreshToken(payload);
    const session = await AuthSession.findOneAndUpdate(
      {
        sessionId: payload.sid,
        userId: payload.id,
        refreshTokenHash: hashRefreshToken(rawToken),
        revokedAt: { $exists: false },
        expiresAt: { $gt: now },
      },
      {
        $set: {
          refreshTokenHash: hashRefreshToken(refreshToken),
          lastActiveAt: now,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
          ipAddress: metadata.ipAddress,
        },
      },
      { new: true },
    );
    if (session) return { refreshToken, sessionId: session.sessionId };

    const existing = await AuthSession.findOne({ sessionId: payload.sid, userId: payload.id });
    if (existing && !existing.revokedAt && existing.expiresAt.getTime() > Date.now()) {
      await this.revokeRecord(existing, 'REFRESH_TOKEN_REUSE');
      throw new Error('Phiên đăng nhập không còn an toàn và đã bị thu hồi.');
    }
    throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  public async replaceSessionRole(userId: string, sessionId: string, role: string) {
    const session = await AuthSession.findOne({
      sessionId,
      userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    if (!session) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    const refreshToken = generalRefreshToken({ id: userId, role, sid: sessionId });
    session.refreshTokenHash = hashRefreshToken(refreshToken);
    session.lastActiveAt = new Date();
    session.expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await session.save();
    return refreshToken;
  }

  public async listActiveSessions(userId: string, currentSessionId: string) {
    const sessions = await AuthSession.find({
      userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }).sort({ lastActiveAt: -1 }).lean();

    return sessions
      .map((session) => ({
        id: session.sessionId,
        deviceType: session.deviceType,
        deviceName: session.deviceName,
        browser: session.browser,
        operatingSystem: session.operatingSystem,
        ipAddress: session.ipAddress,
        signedInAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        expiresAt: session.expiresAt,
        current: session.sessionId === currentSessionId,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  public async revokeSession(userId: string, sessionId: string, currentSessionId: string): Promise<void> {
    if (sessionId === currentSessionId) throw new Error('Hãy dùng chức năng Đăng xuất để kết thúc phiên hiện tại.');
    const session = await AuthSession.findOne({
      sessionId,
      userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    if (!session) throw new Error('Không tìm thấy phiên đăng nhập đang hoạt động.');
    await this.revokeRecord(session, 'REMOTE_LOGOUT');
  }

  public async revokeOthers(userId: string, currentSessionId: string): Promise<number> {
    const sessions = await AuthSession.find({
      userId,
      sessionId: { $ne: currentSessionId },
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    await Promise.all(sessions.map((session) => this.revokeRecord(session, 'REMOTE_LOGOUT_ALL')));
    return sessions.length;
  }

  public async revokeCurrent(userId: string, sessionId: string): Promise<void> {
    const session = await AuthSession.findOne({ sessionId, userId });
    if (session) await this.revokeRecord(session, 'LOGOUT');
  }

  public async revokeAll(userId: string, reason: string): Promise<number> {
    const sessions = await AuthSession.find({
      userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    await Promise.all(sessions.map((session) => this.revokeRecord(session, reason)));
    return sessions.length;
  }
}

export default new AuthSessionService();
