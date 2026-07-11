import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import policyService from '../services/policy.service';

class PolicyController {
  listPublic = async (_req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Lấy danh sách chính sách thành công.', data: await policyService.listPublic() }); }
    catch (error) { res.status((error as any).status || 500).json({ status: 'ERR', message: (error as Error).message }); }
  };

  getPublicBySlug = async (req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Lấy chính sách thành công.', data: await policyService.getPublicBySlug(req.params.slug as string) }); }
    catch (error) { res.status((error as any).status || 500).json({ status: 'ERR', message: (error as Error).message }); }
  };

  listAdmin = async (_req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Lấy danh sách chính sách thành công.', data: await policyService.listAdmin() }); }
    catch (error) { res.status((error as any).status || 500).json({ status: 'ERR', message: (error as Error).message }); }
  };

  create = async (req: AuthRequest, res: Response) => {
    try { res.status(201).json({ status: 'OK', message: 'Đã thêm chính sách mới.', data: await policyService.create(req.body) }); }
    catch (error) { res.status((error as any).status || 500).json({ status: 'ERR', message: (error as Error).message }); }
  };

  update = async (req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Đã cập nhật chính sách.', data: await policyService.update(req.params.id as string, req.body) }); }
    catch (error) { res.status((error as any).status || 500).json({ status: 'ERR', message: (error as Error).message }); }
  };

  setStatus = async (req: AuthRequest, res: Response) => {
    try { res.json({ status: 'OK', message: 'Đã cập nhật trạng thái chính sách.', data: await policyService.setStatus(req.params.id as string, req.body.isActive) }); }
    catch (error) { res.status((error as any).status || 500).json({ status: 'ERR', message: (error as Error).message }); }
  };

  delete = async (req: AuthRequest, res: Response) => {
    try { await policyService.delete(req.params.id as string); res.json({ status: 'OK', message: 'Đã xóa chính sách.' }); }
    catch (error) { res.status((error as any).status || 500).json({ status: 'ERR', message: (error as Error).message }); }
  };
}

export default new PolicyController();
