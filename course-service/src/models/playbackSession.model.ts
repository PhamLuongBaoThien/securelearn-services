// ========================
// PlaybackSession Model
// Mục đích:
// - theo dõi playback session hiện tại của mỗi user
// - giúp chặn nhiều tab/session đồng thời và heartbeat đến nhanh hơn thời gian thực
// ========================
import mongoose, { Schema } from 'mongoose';

const schema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true },
    lessonId: { type: String, required: true },
    lastSegmentIndex: { type: Number, default: -1 },
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const PlaybackSession = mongoose.model('PlaybackSession', schema);
