import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware";
import service from "../services/cannedReply.service";
const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ status: "OK", data });
const fail = (res: Response, e: unknown) =>
  res
    .status(
      e instanceof Error && e.message.includes("không tồn tại") ? 404 : 400,
    )
    .json({
      status: "ERR",
      message: e instanceof Error ? e.message : "Lỗi hệ thống.",
    });
export const cannedReplyController = {
  list: async (req: AuthRequest, res: Response) => {
    try {
      ok(res, await service.list(req.query));
    } catch (e) {
      fail(res, e);
    }
  },
  create: async (req: AuthRequest, res: Response) => {
    try {
      ok(res, await service.create(req.userId!, req.body), 201);
    } catch (e) {
      fail(res, e);
    }
  },
  update: async (req: AuthRequest, res: Response) => {
    try {
      ok(
        res,
        await service.update(req.userId!, String(req.params.id), req.body),
      );
    } catch (e) {
      fail(res, e);
    }
  },
  remove: async (req: AuthRequest, res: Response) => {
    try {
      ok(res, await service.remove(req.userId!, String(req.params.id)));
    } catch (e) {
      fail(res, e);
    }
  },
};
