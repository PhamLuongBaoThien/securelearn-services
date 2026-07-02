import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware";
import ticketService from "../services/ticket.service";
const actor = (r: AuthRequest) => ({
  id: r.userId!,
  type: r.identityType!,
  role: r.userRole!,
  name: r.userName,
  email: r.userEmail,
});
const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ status: "OK", data });
const fail = (res: Response, e: unknown) => {
  const m = e instanceof Error ? e.message : "Lỗi hệ thống.";
  res
    .status(
      /không có quyền|dành cho/.test(m)
        ? 403
        : /không tồn tại/.test(m)
          ? 404
          : 400,
    )
    .json({ status: "ERR", message: m });
};
export const controller = {
  create: async (req: AuthRequest, res: Response) => {
    try {
      ok(res, await ticketService.create(actor(req), req.body), 201);
    } catch (e) {
      fail(res, e);
    }
  },
  list: async (req: AuthRequest, res: Response) => {
    try {
      ok(res, await ticketService.list(actor(req), req.query));
    } catch (e) {
      fail(res, e);
    }
  },
  detail: async (req: AuthRequest, res: Response) => {
    try {
      ok(
        res,
        await ticketService.detail(
          actor(req),
          String(req.params.id),
          req.query,
        ),
      );
    } catch (e) {
      fail(res, e);
    }
  },
  message: async (req: AuthRequest, res: Response) => {
    try {
      ok(
        res,
        await ticketService.message(
          actor(req),
          String(req.params.id),
          req.body,
        ),
        201,
      );
    } catch (e) {
      fail(res, e);
    }
  },
  status: async (req: AuthRequest, res: Response) => {
    try {
      ok(
        res,
        await ticketService.status(
          actor(req),
          String(req.params.id),
          req.body.status,
        ),
      );
    } catch (e) {
      fail(res, e);
    }
  },
  upload: async (req: AuthRequest, res: Response) => {
    try {
      ok(
        res,
        await ticketService.upload(
          actor(req),
          String(req.params.id),
          (req.files || []) as Express.Multer.File[],
        ),
        201,
      );
    } catch (e) {
      fail(res, e);
    }
  },
  attachment: async (req: AuthRequest, res: Response) => {
    try {
      const { row, stream } = await ticketService.attachment(
        actor(req),
        String(req.params.id),
      );
      res.setHeader("Content-Type", row.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(row.originalName)}"`,
      );
      stream.pipe(res);
    } catch (e) {
      fail(res, e);
    }
  },
};
