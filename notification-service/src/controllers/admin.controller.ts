import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import templateService from '../services/template.service';
import notificationService from '../services/notification.service';
const run = (fn: (r: AuthRequest) => Promise<any>, status = 200) => async (req: AuthRequest, res: Response) => { try {
    res.status(status).json({ status: 'OK', data: await fn(req) });
}
catch (error: any) {
    res.status(400).json({ status: 'ERR', message: error.message });
} };
export default { listTemplates: run(() => templateService.list()), createTemplate: run(r => templateService.create(r.body), 201), updateTemplate: run(r => templateService.update(String(r.params.id), r.body)), deleteTemplate: run(async (r) => { await templateService.remove(String(r.params.id)); return { deleted: true }; }), createCampaign: run(r => notificationService.createCampaign(r.userId!, r.body), 201), listCampaigns: run(r => notificationService.listCampaigns(r.query)), getCampaign: run(r => notificationService.getCampaign(String(r.params.id))) };

