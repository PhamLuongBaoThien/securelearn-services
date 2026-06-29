import mongoose, { Document, Schema } from 'mongoose';

export type SessionDeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface IAuthSession extends Document {
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  refreshTokenHash: string;
  userAgent: string;
  deviceType: SessionDeviceType;
  deviceName: string;
  browser: string;
  operatingSystem: string;
  ipAddress: string;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokeReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const authSessionSchema = new Schema<IAuthSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true },
    userAgent: { type: String, default: 'Không xác định' },
    deviceType: { type: String, enum: ['desktop', 'mobile', 'tablet', 'unknown'], default: 'unknown' },
    deviceName: { type: String, default: 'Thiết bị không xác định' },
    browser: { type: String, default: 'Không xác định' },
    operatingSystem: { type: String, default: 'Không xác định' },
    ipAddress: { type: String, default: 'Không xác định' },
    lastActiveAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokeReason: { type: String },
  },
  { timestamps: true },
);

authSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthSession = mongoose.model<IAuthSession>('AuthSession', authSessionSchema);
