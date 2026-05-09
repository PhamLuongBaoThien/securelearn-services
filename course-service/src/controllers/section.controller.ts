// File này là controller cho Section.
// Nó chỉ map HTTP request sang sectionService, còn rule nghiệp vụ nằm ở service.
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import sectionService from '../services/section.service';

class SectionController {
  public async createSection(req: AuthRequest, res: Response): Promise<void> {
    try {
      const section = await sectionService.createSection(req.params.courseId as string, req.userId!, {
        title: req.body.title,
        order: req.body.order,
      });

      res.status(201).json({ status: 'OK', message: 'Tạo chương thành công.', data: section });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async updateSection(req: AuthRequest, res: Response): Promise<void> {
    try {
      const section = await sectionService.updateSection(
        req.params.courseId as string,
        req.params.sectionId as string,
        req.userId!,
        { title: req.body.title }
      );

      res.status(200).json({ status: 'OK', message: 'Cập nhật chương thành công.', data: section });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async deleteSection(req: AuthRequest, res: Response): Promise<void> {
    try {
      await sectionService.deleteSection(req.params.courseId as string, req.params.sectionId as string, req.userId!);
      res.status(200).json({ status: 'OK', message: 'Xóa chương thành công.' });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 404;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async reorderSections(req: AuthRequest, res: Response): Promise<void> {
    try {
      await sectionService.reorderSections(req.params.courseId as string, req.userId!, req.body.items);
      res.status(200).json({ status: 'OK', message: 'Cập nhật thứ tự chương thành công.' });
    } catch (error: any) {
      const status = error.message.includes('quyền') ? 403 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new SectionController();
