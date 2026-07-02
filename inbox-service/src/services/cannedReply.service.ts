import { CannedReply } from "../models/cannedReply.model";
import { TICKET_TYPES } from "../models/ticket.model";
class CannedReplyService {
  async list(q: any) {
    const page = Math.max(1, Number(q.page) || 1),
      limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const filter: any = {};
    if (q.type) filter.$or = [{ ticketType: q.type }, { ticketType: null }];
    if (q.active !== undefined) filter.isActive = String(q.active) !== "false";
    if (q.search) {
      const v = String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$and = [
        {
          $or: [
            { title: { $regex: v, $options: "i" } },
            { content: { $regex: v, $options: "i" } },
          ],
        },
      ];
    }
    const [items, total] = await Promise.all([
      CannedReply.find(filter)
        .sort({ title: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CannedReply.countDocuments(filter),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
  async create(adminId: string, input: any) {
    this.validate(input);
    const row = await CannedReply.create({
      ...this.values(input),
      createdBy: adminId,
      updatedBy: adminId,
    });
    console.info(
      JSON.stringify({ event: "canned_reply_created", id: row.id, adminId }),
    );
    return row;
  }
  async update(adminId: string, id: string, input: any) {
    if (
      input.title !== undefined ||
      input.content !== undefined ||
      input.ticketType !== undefined
    )
      this.validate({
        ...input,
        title: input.title ?? "x",
        content: input.content ?? "x",
      });
    const row = await CannedReply.findByIdAndUpdate(
      id,
      { $set: { ...this.values(input, true), updatedBy: adminId } },
      { new: true },
    );
    if (!row) throw new Error("Mẫu trả lời không tồn tại.");
    console.info(
      JSON.stringify({ event: "canned_reply_updated", id, adminId }),
    );
    return row;
  }
  async remove(adminId: string, id: string) {
    const row = await CannedReply.findByIdAndDelete(id);
    if (!row) throw new Error("Mẫu trả lời không tồn tại.");
    console.info(
      JSON.stringify({ event: "canned_reply_deleted", id, adminId }),
    );
    return { id };
  }
  private validate(input: any) {
    if (
      !String(input.title || "").trim() ||
      !String(input.content || "").trim()
    )
      throw new Error("Tiêu đề và nội dung mẫu là bắt buộc.");
    if (input.ticketType && !TICKET_TYPES.includes(input.ticketType))
      throw new Error("Loại ticket không hợp lệ.");
  }
  private values(input: any, partial = false) {
    const value: any = {};
    for (const key of ["title", "content"])
      if (input[key] !== undefined) value[key] = String(input[key]).trim();
    if (input.ticketType !== undefined)
      value.ticketType = input.ticketType || null;
    if (input.isActive !== undefined) value.isActive = Boolean(input.isActive);
    if (!partial && input.isActive === undefined) value.isActive = true;
    return value;
  }
}
export default new CannedReplyService();
