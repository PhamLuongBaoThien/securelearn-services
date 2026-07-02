import jwt from "jsonwebtoken";
import redisClient from "../config/redis";
export type InboxIdentity = {
  id: string;
  role: string;
  identityType: "USER" | "ADMIN";
  permissions: string[];
  name: string;
  email: string;
  sid?: string;
};
export async function verifyInboxToken(token?: string): Promise<InboxIdentity> {
  if (!token || !process.env.ACCESS_TOKEN)
    throw new Error("Token không hợp lệ.");
  const d = jwt.verify(token, process.env.ACCESS_TOKEN) as jwt.JwtPayload;
  if (!d.id || !d.role) throw new Error("Token không hợp lệ.");
  const identityType = d.role === "ADMIN" ? "ADMIN" : "USER";
  const permissions = Array.isArray(d.permissions)
    ? d.permissions.map(String)
    : [];
  if (identityType === "ADMIN" && !permissions.includes("inbox:manage"))
    throw new Error("Bạn không có quyền quản lý hộp thư.");
  const keys = [
    identityType === "ADMIN" ? `locked_admin:${d.id}` : `locked_user:${d.id}`,
  ];
  if (d.sid) keys.push(`revoked_session:${d.sid}`);
  if (
    redisClient.status === "ready" &&
    (await redisClient.mget(...keys)).some(Boolean)
  )
    throw new Error("Phiên đăng nhập không còn hợp lệ.");
  return {
    id: String(d.id),
    role: String(d.role),
    identityType,
    permissions,
    name: String(d.fullName || d.name || ""),
    email: String(d.email || ""),
    sid: d.sid ? String(d.sid) : undefined,
  };
}
