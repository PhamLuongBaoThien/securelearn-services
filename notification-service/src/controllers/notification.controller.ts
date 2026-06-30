import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import notificationService from '../services/notification.service';
const run = (fn: (req: AuthRequest) => Promise<any>, status = 200) => async (req: AuthRequest, res: Response) => { try {
    res.status(status).json({ status: 'OK', data: await fn(req) });
}
catch (error: any) {
    res.status(400).json({ status: 'ERR', message: error.message });
} };
export default { list: run(r => notificationService.list(r.userId!, r.query)), unreadCount: run(async (r) => ({ count: await notificationService.unreadCount(r.userId!) })), markRead: run(r => notificationService.markRead(r.userId!, String(r.params.id))), markAllRead: run(r => notificationService.markAllRead(r.userId!)) };

