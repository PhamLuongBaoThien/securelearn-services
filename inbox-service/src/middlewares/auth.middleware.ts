import type { Request, Response, NextFunction } from "express";
import { verifyInboxToken, type InboxIdentity } from "../services/auth.service";
export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  permissions?: string[];
  identityType?: "USER" | "ADMIN";
  userName?: string;
  userEmail?: string;
}
export const extractUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const i: InboxIdentity = await verifyInboxToken(
      req.header("Authorization")?.replace(/^Bearer\s+/i, ""),
    );
    req.userId = i.id;
    req.userRole = i.role;
    req.permissions = i.permissions;
    req.identityType = i.identityType;
    req.userName = i.name;
    req.userEmail = i.email;
    next();
  } catch (e) {
    res
      .status(401)
      .json({
        status: "ERR",
        message: e instanceof Error ? e.message : "Token không hợp lệ.",
      });
  }
};
export const requireUser = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (req.identityType !== "USER")
    return res
      .status(403)
      .json({ status: "ERR", message: "API dành cho người dùng." });
  next();
};
export const requireInboxAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (
    req.identityType !== "ADMIN" ||
    !req.permissions?.includes("inbox:manage")
  )
    return res
      .status(403)
      .json({ status: "ERR", message: "Bạn không có quyền quản lý hộp thư." });
  next();
};
