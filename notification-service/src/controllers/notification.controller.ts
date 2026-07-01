import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import notificationService from '../services/notification.service';
import preferenceService, { type RecipientType } from '../services/preference.service';
import templateService from '../services/template.service';
const run = (fn: (req: AuthRequest) => Promise<unknown>) => async (req: AuthRequest, res: Response) => { try { res.status(200).json({ status: 'OK', data: await fn(req) }); } catch (error: any) { res.status(400).json({ status: 'ERR', message: error.message }); } };
const recipientType = (req: AuthRequest): RecipientType => req.userRole === 'ADMIN' ? 'ADMIN' : 'USER';
export default {
  list: run(req => notificationService.list(recipientType(req), req.userId!, req.query)),
  recent: run(req => notificationService.recent(recipientType(req), req.userId!)),
  unreadCount: run(async req => ({ count: await notificationService.unreadCount(recipientType(req), req.userId!) })),
  markRead: run(req => notificationService.markRead(recipientType(req), req.userId!, String(req.params.id))),
  markAllRead: run(req => notificationService.markAllRead(recipientType(req), req.userId!)),
  getPreferences: run(req => preferenceService.get(recipientType(req), req.userId!)),
  getCapabilities: run(() => templateService.channelCapabilities()),
  updatePreferences: run(req => preferenceService.update(recipientType(req), req.userId!, req.body)),
};