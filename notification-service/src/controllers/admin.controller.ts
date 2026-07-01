import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import templateService from '../services/template.service';
import notificationService from '../services/notification.service';
const run = (fn: (req: AuthRequest) => Promise<unknown>, status = 200) => async (req: AuthRequest, res: Response) => { try { res.status(status).json({ status: 'OK', data: await fn(req) }); } catch (error: any) { res.status(400).json({ status: 'ERR', message: error.message }); } };
export default {
  listTemplates: run(() => templateService.list()), createTemplate: run(req => templateService.create(req.body), 201),
  updateTemplate: run(req => templateService.update(String(req.params.id), req.body)),
  deleteTemplate: run(async req => { await templateService.remove(String(req.params.id)); return { deleted: true }; }),
  createCampaign: run(req => notificationService.queueCampaign(req.userId!, req.body), 202),
  listCampaigns: run(req => notificationService.listCampaigns(req.query)),
  getCampaign: run(req => notificationService.getCampaign(String(req.params.id))),
  retryCampaign: run(req => notificationService.retryCampaign(String(req.params.id))),
};