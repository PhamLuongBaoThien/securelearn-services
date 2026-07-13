import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware";
import chatbotService from "../services/chatbot.service";

const getActor = (req: AuthRequest) => ({ userId: req.identityType === "USER" ? req.userId : undefined });

class ChatbotController {
  message = async (req: AuthRequest, res: Response) => {
    try {
      const data = await chatbotService.handleMessage({
        message: req.body.message,
        conversationId: req.body.conversationId,
        guestToken: req.body.guestToken,
        actor: getActor(req),
      });
      res.json({ status: "OK", data });
    } catch (error: any) {
      res.status(error.status || 500).json({ status: "ERR", message: error.message || "Chatbot chưa thể phản hồi." });
    }
  };

  conversations = async (req: AuthRequest, res: Response) => {
    try {
      const data = await chatbotService.listConversations({
        actor: getActor(req),
        conversationId: req.query.conversationId,
        guestToken: req.query.guestToken,
      });
      res.json({ status: "OK", data });
    } catch (error: any) {
      res.status(error.status || 500).json({ status: "ERR", message: error.message || "Không thể lấy lịch sử chatbot." });
    }
  };

  messages = async (req: AuthRequest, res: Response) => {
    try {
      const data = await chatbotService.listMessages({
        actor: getActor(req),
        conversationId: req.params.id,
        guestToken: req.query.guestToken,
      });
      res.json({ status: "OK", data });
    } catch (error: any) {
      res.status(error.status || 500).json({ status: "ERR", message: error.message || "Không thể lấy tin nhắn chatbot." });
    }
  };

  remove = async (req: AuthRequest, res: Response) => {
    try {
      const data = await chatbotService.removeConversation({
        actor: getActor(req),
        conversationId: req.params.id,
        guestToken: req.body.guestToken || req.query.guestToken,
      });
      res.json({ status: "OK", data });
    } catch (error: any) {
      res.status(error.status || 500).json({ status: "ERR", message: error.message || "Không thể xóa lịch sử chatbot." });
    }
  };

  clear = async (req: AuthRequest, res: Response) => {
    try {
      const data = await chatbotService.clearConversations({
        actor: getActor(req),
        conversationId: req.body.conversationId,
        guestToken: req.body.guestToken,
      });
      res.json({ status: "OK", data });
    } catch (error: any) {
      res.status(error.status || 500).json({ status: "ERR", message: error.message || "Không thể xóa lịch sử chatbot." });
    }
  };
}

export const chatbotController = new ChatbotController();
