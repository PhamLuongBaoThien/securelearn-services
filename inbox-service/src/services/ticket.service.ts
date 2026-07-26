import crypto from "crypto";
import { Types } from "mongoose";
import { RoutingKey, type InboxEventType } from "@securelearn/common";
import { Ticket, TICKET_TYPES, TICKET_STATUSES } from "../models/ticket.model";
import { TicketMessage } from "../models/ticketMessage.model";
import { TicketActivity } from "../models/ticketActivity.model";
import { TicketAttachment } from "../models/ticketAttachment.model";
import { TicketReadState } from "../models/ticketReadState.model";
import { emitMessageNew, emitRead, emitTicketNew, emitTicketUpdated, emitUnreadInvalidated } from "./realtime.service";
import { identityGrpcClient, courseGrpcClient } from "../config/grpc";
import { enqueueEvent } from "./outbox.service";
import { storeFile, getFile } from "./storage.service";
type Actor = {
  id: string;
  type: "USER" | "ADMIN";
  role: string;
  name?: string;
  email?: string;
};
const eventKey: Record<string, RoutingKey> = {
  REPORT: RoutingKey.REPORT_CREATED,
  SUPPORT: RoutingKey.SUPPORT_REQUEST_CREATED,
  FEEDBACK: RoutingKey.FEEDBACK_CREATED,
};
class TicketService {
  private async shouldSuppressInitialAttachmentReplyNotification(
    actor: Actor,
    ticket: any,
    id: string,
    attachmentIds: string[],
    silentNotification: boolean,
  ) {
    if (actor.type !== "USER" || !attachmentIds.length || !silentNotification)
      return false;
    const publicMessages = await TicketMessage.find({
      ticketId: id,
      internal: false,
    })
      .sort({ createdAt: 1 })
      .limit(2)
      .select("author content")
      .lean();
    return (
      publicMessages.length === 1 &&
      publicMessages[0]?.author?.type === "USER" &&
      publicMessages[0]?.content === ticket.description
    );
  }
  private async snapshot(actor: Actor) {
    const row = await identityGrpcClient.getIdentitySnapshot({
      identityId: actor.id,
      identityType: actor.type,
    });
    if (!row.found || !row.active)
      throw new Error("Tài khoản không tồn tại hoặc không hoạt động.");
    return {
      id: row.identityId,
      name: row.fullName,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatarUrl || "",
      permissions: row.permissions,
    };
  }
  private async hydrateMessageAuthors(messages: any[]) {
    const identities = new Map<string, { id: string; type: "USER" | "ADMIN" }>();
    for (const message of messages) {
      const id = String(message.author?.id || "");
      const type = message.author?.type;
      if (id && (type === "USER" || type === "ADMIN"))
        identities.set(`${type}:${id}`, { id, type });
    }
    const snapshots = await Promise.all(
      Array.from(identities.entries()).map(async ([key, identity]) => {
        try {
          const row = await identityGrpcClient.getIdentitySnapshot({
            identityId: identity.id,
            identityType: identity.type,
          });
          return [
            key,
            row.found
              ? { name: row.fullName, role: row.role, avatarUrl: row.avatarUrl || "" }
              : null,
          ] as const;
        } catch {
          // Keep inbox available while identity-service is temporarily unavailable.
          return [key, null] as const;
        }
      }),
    );
    const snapshotByIdentity = new Map(snapshots);
    return messages.map((message) => {
      const key = `${message.author?.type}:${message.author?.id}`;
      const current = snapshotByIdentity.get(key);
      return current
        ? { ...message, author: { ...message.author, ...current } }
        : message;
    });
  }
  private async target(input: any) {
    if (input.type === "USER") {
      const r = await identityGrpcClient.getIdentitySnapshot({
        identityId: String(input.id || ""),
        identityType: "USER",
      });
      if (!r.found) return null;
      return {
        type: "USER",
        id: r.identityId,
        title: r.fullName,
        courseId: "",
        ownerUserId: r.identityId,
        actionUrl: `/users/${r.identityId}`,
      };
    }
    return courseGrpcClient.getReportTargetSnapshot({
      targetType: String(input.type || ""),
      targetId: String(input.id || ""),
      parentCourseId: String(input.courseId || ""),
    });
  }
  private eventPayload(
    ticket: any,
    actor: Actor,
    extra: Record<string, unknown> = {},
  ) {
    return {
      eventId: crypto.randomUUID(),
      ticketId: ticket.id,
      resourceId: ticket.id,
      type: ticket.type as InboxEventType,
      title: ticket.title,
      summary: ticket.description.slice(0, 240),
      senderId: ticket.sender.id,
      senderName: ticket.sender.name,
      senderEmail: ticket.sender.email,
      senderRole: ticket.sender.role,
      actorId: actor.id,
      actorType: actor.type,
      status: ticket.status,
      createdAt: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      actionUrl:
        actor.type === "USER"
          ? `/admin/notifications/inbox?id=${ticket.id}`
          : `/support/tickets/${ticket.id}`,
      ...extra,
    };
  }
  async create(actor: Actor, input: any) {
    if (
      !TICKET_TYPES.includes(input.type) ||
      !String(input.title || "").trim() ||
      !String(input.description || "").trim()
    )
      throw new Error("Loại, tiêu đề và nội dung là bắt buộc.");
    const sender = await this.snapshot(actor);
    let target = null;
    if (input.type === "REPORT") {
      if (!input.target?.type || !input.target?.id)
        throw new Error("Báo cáo phải có đối tượng.");
      target = await this.target(input.target);
      if (!(target as any)?.found && input.target.type !== "USER")
        throw new Error("Đối tượng báo cáo không tồn tại hoặc không khớp.");
      if (!target) throw new Error("Đối tượng báo cáo không tồn tại.");
    }
    const ticket = await Ticket.create({
      type: input.type,
      title: String(input.title).trim(),
      description: String(input.description).trim(),
      lastMessageContent: String(input.description).trim(),
      lastMessageAuthorType: "USER",
      lastMessageSenderId: sender.id,
      lastMessageSenderName: sender.name,
      sender,
      target,
      status: "OPEN",
    });
    const message = await TicketMessage.create({
      ticketId: ticket._id,
      author: {
        id: sender.id,
        name: sender.name,
        role: sender.role,
        avatarUrl: sender.avatarUrl,
        type: "USER",
      },
      content: ticket.description,
    });
    await TicketActivity.create({
      ticketId: ticket._id,
      actor: { id: sender.id, name: sender.name, type: "USER" },
      action: "CREATED",
    });
    await enqueueEvent(eventKey[ticket.type], this.eventPayload(ticket, actor));
    await TicketReadState.create({ ticketId: ticket._id, identityType: "USER", identityId: actor.id, lastReadMessageId: message._id, lastReadAt: new Date() });
    emitTicketNew(ticket.toObject());
    emitUnreadInvalidated("ADMIN");
    return ticket;
  }
  async list(actor: Actor, q: any) {
    const page = Math.max(1, Number(q.page) || 1),
      limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const f: any = actor.type === "USER" ? { "sender.id": actor.id } : {};
    for (const k of ["type", "status"]) if (q[k]) f[k] = q[k];
    if (q.targetType) f["target.type"] = q.targetType;
    if (q.search) {
      const v = String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      f.$or = [
        { title: { $regex: v, $options: "i" } },
        { description: { $regex: v, $options: "i" } },
      ];
    }
    const date: any = {};
    if (q.from) date.$gte = new Date(q.from);
    if (q.to) date.$lte = new Date(`${q.to}T23:59:59.999Z`);
    if (Object.keys(date).length) f.createdAt = date;
    const sortOptions: Record<string, Record<string, 1 | -1>> = {
      activity_desc: { lastActivityAt: -1 },
      activity_asc: { lastActivityAt: 1 },
      created_desc: { createdAt: -1 },
      created_asc: { createdAt: 1 },
    };
    const sortOption = sortOptions[String(q.sort || 'activity_desc')] || sortOptions.activity_desc;
    const [items, total] = await Promise.all([
      Ticket.find(f)
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Ticket.countDocuments(f),
    ]);
    const states = await TicketReadState.find({ ticketId: { $in: items.map((item: any) => item._id) }, identityType: actor.type, identityId: actor.id }).lean();
    const readByTicket = new Map(states.map((state: any) => [String(state.ticketId), state.lastReadAt]));
    const mapped = items.map((item: any) => ({ ...item, unread: new Date(actor.type === "ADMIN" ? item.lastMessageAt : item.lastPublicMessageAt).getTime() > new Date(readByTicket.get(String(item._id)) || 0).getTime() }));
    return { items: mapped, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
  async detail(actor: Actor, id: string, query: any = {}) {
    if (!Types.ObjectId.isValid(id)) throw new Error("Ticket không hợp lệ.");
    const f: any = { _id: id };
    if (actor.type === "USER") f["sender.id"] = actor.id;
    const ticket = await Ticket.findOne(f).lean();
    if (!ticket) throw new Error("Ticket không tồn tại.");
    const messagePage = Math.max(1, Number(query.messagePage) || 1),
      messageLimit = Math.min(
        50,
        Math.max(1, Number(query.messageLimit) || 10),
      );
    const activityPage = Math.max(1, Number(query.activityPage) || 1),
      activityLimit = Math.min(
        50,
        Math.max(1, Number(query.activityLimit) || 10),
      );
    const mf: any = { ticketId: id };
    if (actor.type === "USER") mf.internal = false;
    const [messageRows, messageTotal, activityRows, activityTotal] =
      await Promise.all([
        TicketMessage.find(mf)
          .sort({ createdAt: -1 })
          .skip((messagePage - 1) * messageLimit)
          .limit(messageLimit)
          .lean(),
        TicketMessage.countDocuments(mf),
        actor.type === "ADMIN"
          ? TicketActivity.find({ ticketId: id })
              .sort({ createdAt: -1 })
              .skip((activityPage - 1) * activityLimit)
              .limit(activityLimit)
              .lean()
          : Promise.resolve([]),
        actor.type === "ADMIN"
          ? TicketActivity.countDocuments({ ticketId: id })
          : Promise.resolve(0),
      ]);
    const messages = await this.hydrateMessageAuthors(messageRows.reverse());
    const attachmentIds = messages.flatMap(
      (message: any) => message.attachmentIds || [],
    );
    const attachments = attachmentIds.length
      ? await TicketAttachment.find({
          _id: { $in: attachmentIds },
          ticketId: id,
        })
          .select("-objectKey")
          .lean()
      : [];
    return {
      ...ticket,
      messages: {
        items: messages,
        total: messageTotal,
        page: messagePage,
        limit: messageLimit,
        totalPages: Math.ceil(messageTotal / messageLimit),
      },
      activities: {
        items: activityRows,
        total: activityTotal,
        page: activityPage,
        limit: activityLimit,
        totalPages: Math.ceil(activityTotal / activityLimit),
      },
      attachments,
    };
  }
  async message(actor: Actor, id: string, input: any) {
    const ticket: any = await Ticket.findOne({
      _id: id,
      ...(actor.type === "USER" ? { "sender.id": actor.id } : {}),
    });
    if (!ticket) throw new Error("Ticket không tồn tại.");
    if (ticket.status === "CLOSED") throw new Error("Ticket đã đóng.");
    const content = String(input.content || "").trim();
    const attachmentIds: string[] = Array.isArray(input.attachmentIds)
      ? Array.from(new Set((input.attachmentIds as unknown[]).map((value) => String(value))))
      : [];
    if (attachmentIds.length > 5)
      throw new Error("Mỗi phản hồi chỉ được tối đa 5 tệp.");
    if (attachmentIds.length) {
      const owned = await TicketAttachment.countDocuments({
        _id: { $in: attachmentIds },
        ticketId: id,
        ownerId: actor.id,
        messageId: null,
      });
      if (owned !== attachmentIds.length)
        throw new Error(
          "Tệp đính kèm không hợp lệ hoặc không thuộc người gửi.",
        );
    }
    if (!content && !attachmentIds.length)
      throw new Error("Nội dung hoặc tệp đính kèm là bắt buộc.");
    const suppressInitialAttachmentReplyNotification =
      await this.shouldSuppressInitialAttachmentReplyNotification(
        actor,
        ticket,
        id,
        attachmentIds,
        Boolean(input.silentNotification),
      );
    const identity = await this.snapshot(actor);
    const internal = actor.type === "ADMIN" && Boolean(input.internal);
    const message = await TicketMessage.create({
      ticketId: id,
      author: {
        id: identity.id,
        name: identity.name,
        role: identity.role,
        avatarUrl: identity.avatarUrl,
        type: actor.type,
      },
      content,
      internal,
      attachmentIds,
    });
    if (attachmentIds.length)
      await TicketAttachment.updateMany(
        {
          _id: { $in: attachmentIds },
          ticketId: id,
          ownerId: actor.id,
          messageId: null,
        },
        { $set: { messageId: message._id } },
      );
    const old = ticket.status;
    if (actor.type === "USER" && old === "RESOLVED") ticket.status = "OPEN";
    ticket.lastActivityAt = new Date();
    ticket.lastMessageAt = ticket.lastActivityAt;
    if (!internal) {
      ticket.lastPublicMessageAt = ticket.lastActivityAt;
      ticket.lastMessageContent = content || 'Gửi tệp đính kèm';
      ticket.lastMessageAuthorType = actor.type;
      ticket.lastMessageSenderId = identity.id;
      ticket.lastMessageSenderName = identity.name;
    }
    await ticket.save();
    await TicketActivity.create({
      ticketId: id,
      actor: { id: identity.id, name: identity.name, type: actor.type },
      action: internal ? "INTERNAL_NOTE" : "REPLIED",
      fromValue: old,
      toValue: ticket.status,
    });
    if (!internal && !suppressInitialAttachmentReplyNotification)
      await enqueueEvent(
        actor.type === "USER"
          ? RoutingKey.INBOX_USER_REPLIED
          : RoutingKey.INBOX_ADMIN_REPLIED,
        this.eventPayload(ticket, actor, { summary: content.slice(0, 240) }),
      );
    const safeAttachments = attachmentIds.length ? await TicketAttachment.find({ _id: { $in: attachmentIds } }).select("-objectKey").lean() : [];
    emitMessageNew(id, { ticketId: id, message: message.toObject(), attachments: safeAttachments }, ticket.sender.id, !internal);
    if (!internal && !suppressInitialAttachmentReplyNotification) emitUnreadInvalidated(actor.type === "USER" ? "ADMIN" : "USER", ticket.sender.id);
    emitRead(id, actor.type, actor.id, await this.unreadCount(actor));
    return message;
  }
  async status(actor: Actor, id: string, status: string) {
    if (!TICKET_STATUSES.includes(status as any))
      throw new Error("Trạng thái không hợp lệ.");
    const ticket: any = await Ticket.findById(id);
    if (!ticket) throw new Error("Ticket không tồn tại.");
    const old = ticket.status;
    ticket.status = status;
    ticket.lastActivityAt = new Date();
    ticket.lastPublicMessageAt = ticket.lastActivityAt;
    await ticket.save();
    await TicketActivity.create({
      ticketId: id,
      actor: { id: actor.id, name: actor.name, type: "ADMIN" },
      action: "STATUS_CHANGED",
      fromValue: old,
      toValue: status,
    });
    await enqueueEvent(RoutingKey.INBOX_STATUS_CHANGED, this.eventPayload(ticket, actor));
    emitTicketUpdated(id, ticket.toObject(), ticket.sender.id);
    emitUnreadInvalidated("USER", ticket.sender.id);
    return ticket;
  }
  async unreadCount(actor: Actor) {
    const filter: any = actor.type === "USER" ? { "sender.id": actor.id } : {};
    const tickets: any[] = await Ticket.find(filter).select("_id lastMessageAt lastPublicMessageAt").lean();
    const states: any[] = await TicketReadState.find({ ticketId: { $in: tickets.map(t => t._id) }, identityType: actor.type, identityId: actor.id }).lean();
    const read = new Map(states.map(s => [String(s.ticketId), new Date(s.lastReadAt).getTime()]));
    return tickets.filter(t => new Date(actor.type === "ADMIN" ? t.lastMessageAt : t.lastPublicMessageAt).getTime() > (read.get(String(t._id)) || 0)).length;
  }
  async markRead(actor: Actor, id: string) {
    const ticket: any = await Ticket.findOne({ _id: id, ...(actor.type === "USER" ? { "sender.id": actor.id } : {}) });
    if (!ticket) throw new Error("Ticket không tồn tại.");
    const message: any = await TicketMessage.findOne({ ticketId: id, ...(actor.type === "USER" ? { internal: false } : {}) }).sort({ createdAt: -1 }).select("_id").lean();
    await TicketReadState.updateOne({ ticketId: id, identityType: actor.type, identityId: actor.id }, { $set: { lastReadMessageId: message?._id || null, lastReadAt: new Date() } }, { upsert: true });
    const count = await this.unreadCount(actor);
    emitRead(id, actor.type, actor.id, count);
    return { unreadCount: count };
  }  async upload(actor: Actor, id: string, files: Express.Multer.File[]) {
    const ticket = await Ticket.findOne({
      _id: id,
      ...(actor.type === "USER" ? { "sender.id": actor.id } : {}),
    });
    if (!ticket) throw new Error("Ticket không tồn tại.");
    if (ticket.status === "CLOSED") throw new Error("Ticket đã đóng.");
    if (!files.length || files.length > 5)
      throw new Error("Chọn từ 1 đến 5 tệp.");
    const created = [];
    for (const file of files) {
      const stored = await storeFile(id, file);
      created.push(
        await TicketAttachment.create({
          ticketId: id,
          ownerId: actor.id,
          originalName: file.originalname,
          mimeType: stored.mime,
          sizeBytes: file.size,
          objectKey: stored.key,
        }),
      );
    }
    return created.map(({ _id, originalName, mimeType, sizeBytes }) => ({
      _id,
      originalName,
      mimeType,
      sizeBytes,
    }));
  }
  async attachment(actor: Actor, id: string) {
    const row: any = await TicketAttachment.findById(id);
    if (!row) throw new Error("Tệp không tồn tại.");
    const ticket: any = await Ticket.findById(row.ticketId);
    if (!ticket || (actor.type === "USER" && ticket.sender.id !== actor.id))
      throw new Error("Bạn không có quyền truy cập tệp.");
    return { row, stream: await getFile(row.objectKey) };
  }
}
export default new TicketService();






