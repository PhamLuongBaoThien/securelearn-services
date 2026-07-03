import {
  NotificationTemplate,
  TEMPLATE_EVENTS,
} from "../models/notificationTemplate.model";
export const VARIABLE_WHITELIST: Record<string, string[]> = {
  WELCOME: ["userName"],
  PAYMENT_SUCCESS: [
    "userName",
    "amount",
    "transactionId",
    "courseName",
    "createdAt",
  ],
  PAYMENT_FAILED: [
    "userName",
    "amount",
    "transactionId",
    "reason",
    "createdAt",
  ],
  COURSE_APPROVED: ["instructorName", "courseName", "courseUrl"],
  COURSE_REJECTED: ["instructorName", "courseName", "reason"],
  COURSE_SUBMITTED_FOR_REVIEW: ["courseName", "instructorName"],
  ENROLLMENT_CREATED: ["courseName", "learnerName"],
  DISCUSSION_CREATED: ["actorName", "courseName", "lessonName", "contentPreview"],
  DISCUSSION_REPLIED: ["actorName", "courseName", "lessonName", "contentPreview"],
  REPORT_CREATED: ["senderName", "title", "summary", "createdAt"],
  SUPPORT_REQUEST_CREATED: ["senderName", "title", "summary", "createdAt"],
  FEEDBACK_CREATED: ["senderName", "title", "summary", "createdAt"],
  INBOX_USER_REPLIED: ["senderName", "title", "summary", "status"],
  INBOX_ADMIN_REPLIED: ["senderName", "title", "summary", "status"],
  INBOX_STATUS_CHANGED: ["senderName", "title", "summary", "status"],
  MANUAL: ["userName", "userEmail"],
};
export const extractVariables = (text: string) =>
  Array.from(text.matchAll(/{{\s*([A-Za-z][\w]*)\s*}}/g), (match) => match[1]);
export const validateTemplate = (
  event: string,
  type: string,
  subject: string | undefined,
  body: string,
) => {
  if (!TEMPLATE_EVENTS.includes(event as any))
    throw new Error("Sự kiện template không hợp lệ.");
  if (type === "EMAIL" && !subject?.trim())
    throw new Error("Email template phải có tiêu đề.");
  const found = [...extractVariables(subject || ""), ...extractVariables(body)];
  const invalid = found.filter(
    (variable) => !(VARIABLE_WHITELIST[event] || []).includes(variable),
  );
  if (invalid.length)
    throw new Error(
      `Biến template không hợp lệ: ${[...new Set(invalid)].join(", ")}`,
    );
  return [...new Set(found)].map((variable) => `{{${variable}}}`);
};
export const renderTemplate = (text: string, values: Record<string, unknown>) =>
  text.replace(/{{\s*([A-Za-z][\w]*)\s*}}/g, (_, key) =>
    String(values[key] ?? ""),
  );
class TemplateService {
  list() {
    return NotificationTemplate.find().sort({ event: 1, type: 1 }).lean();
  }
  async create(input: any) {
    return NotificationTemplate.create({
      ...input,
      variables: validateTemplate(
        input.event,
        input.type,
        input.subject,
        input.body,
      ),
    });
  }
  async update(id: string, input: any) {
    const current = await NotificationTemplate.findById(id);
    if (!current) throw new Error("Template không tồn tại.");
    const next = {
      event: input.event ?? current.event,
      type: input.type ?? current.type,
      subject: input.subject ?? current.subject,
      body: input.body ?? current.body,
    };
    Object.assign(current, input, {
      variables: validateTemplate(
        String(next.event),
        String(next.type),
        next.subject as string | undefined,
        String(next.body),
      ),
    });
    return current.save();
  }
  async remove(id: string) {
    const result = await NotificationTemplate.findByIdAndDelete(id);
    if (!result) throw new Error("Template không tồn tại.");
  }
  async findActive(event: string, type: string) {
    return NotificationTemplate.findOne({ event, type, isActive: true }).lean();
  }
  async channelCapabilities() {
    const rows = await NotificationTemplate.find({ isActive: true })
      .select("event type")
      .lean();
    const active = new Set(
      rows.map((row) => String(row.event) + ":" + String(row.type)),
    );
    const groups: Record<string, string[]> = {
      SYSTEM: ["WELCOME"],
      PAYMENT: ["PAYMENT_SUCCESS", "PAYMENT_FAILED"],
      COURSE: [
        "COURSE_APPROVED",
        "COURSE_REJECTED",
        "COURSE_SUBMITTED_FOR_REVIEW",
      ],
      LEARNING: ["ENROLLMENT_CREATED", "DISCUSSION_CREATED", "DISCUSSION_REPLIED"],
      INBOX: [
        "REPORT_CREATED",
        "SUPPORT_REQUEST_CREATED",
        "FEEDBACK_CREATED",
        "INBOX_USER_REPLIED",
        "INBOX_ADMIN_REPLIED",
        "INBOX_STATUS_CHANGED",
      ],
    };
    const result: Record<string, unknown> = {};
    for (const [category, events] of Object.entries(groups))
      result[category] = {
        email: events.every((event) => active.has(event + ":EMAIL")),
        emailAvailable: events.some((event) => active.has(event + ":EMAIL")),
        inApp: events.every((event) => active.has(event + ":IN_APP")),
        inAppAvailable: events.some((event) => active.has(event + ":IN_APP")),
        missingEmailEvents: events.filter(
          (event) => !active.has(event + ":EMAIL"),
        ),
        missingInAppEvents: events.filter(
          (event) => !active.has(event + ":IN_APP"),
        ),
      };
    result.CAMPAIGN = {
      email: true,
      emailAvailable: true,
      inApp: true,
      inAppAvailable: true,
      missingEmailEvents: [],
      missingInAppEvents: [],
    };
    return result;
  }
}
export default new TemplateService();

