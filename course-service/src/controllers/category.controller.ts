// File này là controller cho Category.
// Category không trực tiếp thuộc flow create course, nhưng course editor phụ thuộc nó để chọn danh mục.
import { Request, Response } from 'express';
import categoryService from '../services/category.service';
import { AuthRequest } from '../middlewares/auth.middleware';

class CategoryController {
  public async createCategory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { name, description, sortOrder, parentId } = req.body;

      if (!name?.trim()) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp tên danh mục.' });
        return;
      }

      const category = await categoryService.createCategory({
        name,
        description,
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : undefined,
        parentId,
        createdBy: req.userId!,
      });

      res.status(201).json({
        status: 'OK',
        message: 'Tạo danh mục thành công.',
        data: category,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getCategories(_req: Request, res: Response): Promise<void> {
    try {
      const categories = await categoryService.getPublicCategories();
      res.status(200).json({ status: 'OK', data: categories });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async getAdminCategories(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const categories = await categoryService.getAdminCategories();
      res.status(200).json({ status: 'OK', data: categories });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async updateCategory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { name, description, sortOrder, isActive, parentId } = req.body;
      const category = await categoryService.updateCategory(req.params.id as string, {
        name,
        description,
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : undefined,
        isActive,
        parentId,
      });

      res.status(200).json({
        status: 'OK',
        message: 'Cập nhật danh mục thành công.',
        data: category,
      });
    } catch (error: any) {
      const status = error.message.includes('không tồn tại') ? 404 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async setCategoryStatus(req: Request, res: Response): Promise<void> {
    try {
      const { isActive } = req.body;
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ status: 'ERR', message: 'Trường isActive phải là boolean.' });
        return;
      }

      const category = await categoryService.setCategoryStatus(req.params.id as string, isActive);
      res.status(200).json({
        status: 'OK',
        message: 'Cập nhật trạng thái danh mục thành công.',
        data: category,
      });
    } catch (error: any) {
      const status = error.message.includes('không tồn tại') ? 404 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async multiSetCategoryStatus(req: Request, res: Response): Promise<void> {
    try {
      const { ids, isActive } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng chọn ít nhất một danh mục.' });
        return;
      }
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ status: 'ERR', message: 'Trường isActive phải là boolean.' });
        return;
      }

      const result = await categoryService.multiSetCategoryStatus(ids, isActive);
      res.status(200).json({
        status: result.failed > 0 ? 'ERR' : 'OK',
        message: result.failed > 0 ? 'Một số danh mục không thể cập nhật trạng thái.' : 'Cập nhật trạng thái danh mục thành công.',
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async multiDeleteCategories(req: Request, res: Response): Promise<void> {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng chọn ít nhất một danh mục.' });
        return;
      }

      const result = await categoryService.multiDeleteCategories(ids);
      res.status(200).json({
        status: result.failed > 0 ? 'ERR' : 'OK',
        message: result.failed > 0 ? 'Một số danh mục không thể xóa.' : 'Xóa danh mục thành công.',
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async deleteCategory(req: Request, res: Response): Promise<void> {
    try {
      await categoryService.deleteCategory(req.params.id as string);
      res.status(200).json({
        status: 'OK',
        message: 'Xóa danh mục thành công.',
      });
    } catch (error: any) {
      const status = error.message.includes('không tồn tại') ? 404 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new CategoryController();
