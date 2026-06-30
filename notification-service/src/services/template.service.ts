import { NotificationTemplate, TEMPLATE_EVENTS } from '../models/notificationTemplate.model';
export const VARIABLE_WHITELIST: Record<string, string[]> = {
    WELCOME: ['userName'], PAYMENT_SUCCESS: ['userName', 'amount', 'transactionId', 'courseName', 'createdAt'], PAYMENT_FAILED: ['userName', 'amount', 'transactionId', 'reason', 'createdAt'], COURSE_APPROVED: ['instructorName', 'courseName', 'courseUrl'], COURSE_REJECTED: ['instructorName', 'courseName', 'reason'], MANUAL: ['userName', 'userEmail']
};
export const extractVariables = (text: string) => Array.from(text.matchAll(/{{\s*([A-Za-z][\w]*)\s*}}/g), m => m[1]);
export const validateTemplate = (event: string, type: string, subject: string | undefined, body: string) => {
    if (!TEMPLATE_EVENTS.includes(event as any))
        throw new Error('Sự kiện template không hợp lệ.');
    if (type === 'EMAIL' && !subject?.trim())
        throw new Error('Email template phải có tiêu đề.');
    const found = [...extractVariables(subject || ''), ...extractVariables(body)];
    const allowed = VARIABLE_WHITELIST[event] || [];
    const invalid = found.filter(v => !allowed.includes(v));
    if (invalid.length)
        throw new Error(`Biến template không hợp lệ: ${[...new Set(invalid)].join(', ')}`);
    return [...new Set(found)].map(v => `{{${v}}}`);
};
export const renderTemplate = (text: string, values: Record<string, unknown>) => text.replace(/{{\s*([A-Za-z][\w]*)\s*}}/g, (_, key) => String(values[key] ?? ''));
class TemplateService {
    list() { return NotificationTemplate.find().sort({ event: 1, type: 1 }).lean(); }
    async create(input: any) { const variables = validateTemplate(input.event, input.type, input.subject, input.body); return NotificationTemplate.create({ ...input, variables }); }
    async update(id: string, input: any) { const current = await NotificationTemplate.findById(id); if (!current)
        throw new Error('Template không tồn tại.'); const next = { event: input.event ?? current.event, type: input.type ?? current.type, subject: input.subject ?? current.subject, body: input.body ?? current.body }; const variables = validateTemplate(String(next.event), String(next.type), next.subject as string | undefined, String(next.body)); Object.assign(current, input, { variables }); return current.save(); }
    async remove(id: string) { const result = await NotificationTemplate.findByIdAndDelete(id); if (!result)
        throw new Error('Template không tồn tại.'); }
    async findActive(event: string, type: string) { return NotificationTemplate.findOne({ event, type, isActive: true }).lean(); }
}
export default new TemplateService();

