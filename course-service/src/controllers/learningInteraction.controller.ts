// ========================
// Learning Interaction Controller
// Mục đích:
// - mở API ghi chú cá nhân và thảo luận trong màn học
// - chuyển thông tin người dùng từ JWT sang service kiểm tra quyền
// ========================
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import learningInteractionService from '../services/learningInteraction.service';

class LearningInteractionController {
  public listNotes = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.listNotes(
        req.userId!,
        req.userRole!,
        String(req.params.id),
        String(req.params.lessonId),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public createNote = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.createNote(
        req.userId!,
        req.userRole!,
        String(req.params.id),
        String(req.params.lessonId),
        String(req.body.content || ''),
        Number(req.body.timestampSec || 0),
      );
      res.status(201).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public updateNote = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.updateNote(
        req.userId!,
        req.userRole!,
        String(req.params.id),
        String(req.params.lessonId),
        String(req.params.noteId),
        String(req.body.content || ''),
        Number(req.body.timestampSec || 0),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public deleteNote = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.deleteNote(
        req.userId!,
        req.userRole!,
        String(req.params.id),
        String(req.params.lessonId),
        String(req.params.noteId),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public listDiscussions = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.listDiscussions(
        req.userId!,
        req.userRole!,
        String(req.params.id),
        String(req.params.lessonId),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };

  public createDiscussion = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.createDiscussion(
        { id: req.userId!, role: req.userRole!, name: req.userName || '' },
        String(req.params.id),
        String(req.params.lessonId),
        String(req.body.content || ''),
        Number(req.body.timestampSec || 0),
      );
      res.status(201).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(error.message.includes('quyền') ? 403 : 400).json({ status: 'ERR', message: error.message });
    }
  };
}

export default new LearningInteractionController();
