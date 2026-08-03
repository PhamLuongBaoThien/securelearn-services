import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import learningInteractionService from '../services/learningInteraction.service';

const statusFor = (error: Error) =>
  error.message.includes('quyền') || error.message.includes('chủ khóa học') ? 403 : 400;

class LearningInteractionController {
  public listNotes = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.listNotes(req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId));
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public createNote = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.createNote(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId),
        String(req.body.content || ''), Number(req.body.timestampSec || 0),
      );
      res.status(201).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public updateNote = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.updateNote(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId), String(req.params.noteId),
        String(req.body.content || ''), Number(req.body.timestampSec || 0),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public deleteNote = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.deleteNote(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId), String(req.params.noteId),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public listDiscussions = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.listDiscussions(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId), req.query,
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public createDiscussion = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.createDiscussion(
        { id: req.userId!, role: req.userRole!, name: req.userName || '' },
        String(req.params.id), String(req.params.lessonId), String(req.body.content || ''),
        req.body.parentId ? String(req.body.parentId) : undefined,
        req.body.replyToId ? String(req.body.replyToId) : undefined,
      );
      res.status(201).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public listDiscussionReplies = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.listDiscussionReplies(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId),
        String(req.params.discussionId), req.query,
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public setDiscussionReaction = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.setDiscussionReaction(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId),
        String(req.params.discussionId), Boolean(req.body.liked),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };
  public updateDiscussion = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.updateDiscussion(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId),
        String(req.params.discussionId), String(req.body.content || ''),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public deleteDiscussion = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.deleteDiscussion(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId), String(req.params.discussionId),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public moderateDiscussion = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.moderateDiscussion(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId),
        String(req.params.discussionId), Boolean(req.body.hidden),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public pinDiscussion = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.pinDiscussion(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.lessonId),
        String(req.params.discussionId), Boolean(req.body.pinned),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public resolveDiscussionContext = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.resolveDiscussionContext(
        req.userId!, req.userRole!, String(req.params.id), String(req.params.discussionId),
      );
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public listInstructorDiscussions = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.listInstructorDiscussions(req.userId!, req.query);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };

  public listCourseDiscussions = async (req: AuthRequest, res: Response) => {
    try {
      const data = await learningInteractionService.listCourseDiscussions(req.userId!, req.userRole!, String(req.params.id), req.query);
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) { res.status(statusFor(error)).json({ status: 'ERR', message: error.message }); }
  };
}

export default new LearningInteractionController();
