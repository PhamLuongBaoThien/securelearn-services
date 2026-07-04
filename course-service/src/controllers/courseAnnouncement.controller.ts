import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import service from '../services/courseAnnouncement.service';
const fail=(res:Response,e:any)=>res.status(String(e.message).includes('quyền')||String(e.message).includes('chủ khóa học')?403:400).json({status:'ERR',message:e.message});
class Controller {
  create=async(req:AuthRequest,res:Response)=>{try{res.status(201).json({status:'OK',data:await service.create({id:req.userId!,name:req.userName||''},String(req.params.id),req.body)})}catch(e){fail(res,e)}};
  update=async(req:AuthRequest,res:Response)=>{try{res.json({status:'OK',data:await service.update(req.userId!,String(req.params.id),String(req.params.announcementId),req.body)})}catch(e){fail(res,e)}};
  visibility=async(req:AuthRequest,res:Response)=>{try{res.json({status:'OK',data:await service.visibility(req.userId!,String(req.params.id),String(req.params.announcementId),Boolean(req.body.visible))})}catch(e){fail(res,e)}};
  pin=async(req:AuthRequest,res:Response)=>{try{res.json({status:'OK',data:await service.pin(req.userId!,String(req.params.id),String(req.params.announcementId),Boolean(req.body.pinned))})}catch(e){fail(res,e)}};
  list=async(req:AuthRequest,res:Response)=>{try{res.json({status:'OK',data:await service.listForLearner(req.userId!,req.userRole!,String(req.params.id),req.query)})}catch(e){fail(res,e)}};
  unread=async(req:AuthRequest,res:Response)=>{try{res.json({status:'OK',data:{count:await service.unreadCount(req.userId!,String(req.params.id),req.userRole!)}})}catch(e){fail(res,e)}};
  read=async(req:AuthRequest,res:Response)=>{try{res.json({status:'OK',data:await service.read(req.userId!,String(req.params.id),String(req.params.announcementId),req.userRole!)})}catch(e){fail(res,e)}};
  instructorList=async(req:AuthRequest,res:Response)=>{try{res.json({status:'OK',data:await service.listForInstructor(req.userId!,req.query)})}catch(e){fail(res,e)}};
}
export default new Controller();