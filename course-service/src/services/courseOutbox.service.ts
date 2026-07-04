import { Exchange, RoutingKey, publishMessage } from '@securelearn/common';
import { CourseOutboxEvent } from '../models/courseOutboxEvent.model';
let timer: NodeJS.Timeout | undefined;
export const enqueueCourseEvent = (routingKey: RoutingKey, payload: Record<string, unknown>) => CourseOutboxEvent.create({ eventId: String(payload.eventId), exchange: Exchange.COURSE, routingKey, payload });
const tick = async () => {
  const rows = await CourseOutboxEvent.find({ status: 'PENDING', nextAttemptAt: { $lte: new Date() } }).sort({ createdAt: 1 }).limit(20);
  for (const row of rows) try {
    await publishMessage(row.exchange as Exchange, row.routingKey as RoutingKey, row.payload);
    row.status = 'SENT'; row.sentAt = new Date(); await row.save();
  } catch (error) {
    row.attempts += 1; row.lastError = error instanceof Error ? error.message : String(error);
    if (row.attempts >= 3) row.status = 'DEAD';
    else row.nextAttemptAt = new Date(Date.now() + [5000, 30000, 300000][row.attempts - 1]);
    await row.save();
    console.error(JSON.stringify({ event: 'course.outbox.failed', eventId: row.eventId, attempts: row.attempts, error: row.lastError }));
  }
};
export const startCourseOutboxWorker = () => { timer = setInterval(() => void tick(), 3000); void tick(); };
export const stopCourseOutboxWorker = () => { if (timer) clearInterval(timer); };