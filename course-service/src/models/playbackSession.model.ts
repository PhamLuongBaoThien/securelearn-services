// - theo dõi phiên học hiện tại của user để chống học cùng lúc trên nhiều tab
// - xử lý heartbeat định kỳ để ghi nhận thời gian học thực tế
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
