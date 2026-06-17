import crypto from 'crypto';
import redisClient from '../config/redis';

type DocumentViewSessionValue = {
  userId: string;
  documentAssetId: string;
  mode: 'view' | 'download';
  createdAt: string;
};

const DOCUMENT_VIEW_TTL_SECONDS = 5 * 60;

const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const documentViewKey = (token: string): string =>
  `document:view-session:${hashToken(token)}`;

class DocumentViewAccessService {
  public get ttlSeconds(): number {
    return DOCUMENT_VIEW_TTL_SECONDS;
  }

  public async createSession(input: Omit<DocumentViewSessionValue, 'createdAt'>): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    const value: DocumentViewSessionValue = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    await redisClient.setex(documentViewKey(token), DOCUMENT_VIEW_TTL_SECONDS, JSON.stringify(value));
    return token;
  }

  public async validateSession(
    token: string,
    userId: string,
    documentAssetId: string,
    mode: DocumentViewSessionValue['mode'],
  ): Promise<boolean> {
    const raw = await redisClient.get(documentViewKey(token));
    if (!raw) return false;
    try {
      const value = JSON.parse(raw) as DocumentViewSessionValue;
      return value.userId === userId && value.documentAssetId === documentAssetId && value.mode === mode;
    } catch {
      return false;
    }
  }
}

export default new DocumentViewAccessService();
