/**
 * Mục đích: điều phối enqueue và retry các sự kiện usage thuê bao trong progress-service.
 * Tác dụng: ghi sự kiện idempotent vào outbox, gửi qua gRPC, đánh dấu DONE khi thành công
 * và backoff khi thất bại để tách độ ổn định của ghi nhận doanh thu khỏi luồng heartbeat học tập.
 */
import { SubscriptionUsageOutbox } from '../models/subscriptionUsageOutbox.model';
import { paymentGrpcClient } from '../grpc/payment.client';

class SubscriptionUsageOutboxService {
  private running = false;

  async enqueue(payload: any) {
    await SubscriptionUsageOutbox.updateOne(
      { eventId: payload.eventId },
      { $setOnInsert: { eventId: payload.eventId, payload, status: 'PENDING', attempts: 0, nextAttemptAt: new Date() } },
      { upsert: true },
    );
  }

  async flush(limit = 50) {
    if (this.running) return;
    this.running = true;
    try {
      await SubscriptionUsageOutbox.updateMany(
        { status: 'PROCESSING', updatedAt: { $lt: new Date(Date.now() - 60_000) } },
        { $set: { status: 'PENDING', nextAttemptAt: new Date() } },
      );
      const rows = await SubscriptionUsageOutbox.find({ status: 'PENDING', nextAttemptAt: { $lte: new Date() } }).sort({ createdAt: 1 }).limit(limit);
      for (const row of rows) {
        row.status = 'PROCESSING';
        await row.save();
        try {
          await paymentGrpcClient.recordSubscriptionUsage(row.payload);
          row.status = 'DONE';
          row.lastError = '';
        } catch (error: any) {
          row.status = 'PENDING';
          row.attempts += 1;
          row.lastError = String(error?.message || 'Payment gRPC unavailable').slice(0, 500);
          row.nextAttemptAt = new Date(Date.now() + Math.min(300_000, 2 ** Math.min(row.attempts, 8) * 1000));
        }
        await row.save();
      }
      await SubscriptionUsageOutbox.deleteMany({ status: 'DONE', updatedAt: { $lt: new Date(Date.now() - 7 * 86400000) } });
    } finally { this.running = false; }
  }
}
export default new SubscriptionUsageOutboxService();
