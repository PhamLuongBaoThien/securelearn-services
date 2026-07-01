import { Types } from 'mongoose';
import { Exchange, RoutingKey, publishMessage, type NotificationCampaignRequestedPayload } from '@securelearn/common';
import { Notification } from '../models/notification.model';
import { Campaign } from '../models/campaign.model';
import { DeliveryAttempt } from '../models/deliveryAttempt.model';
import templateService, { extractVariables, renderTemplate } from './template.service';
import preferenceService, { type NotificationCategory, type RecipientType } from './preference.service';
import emailService from './email.service';
import { identityGrpcClient } from '../config/identityGrpc';
import { courseGrpcClient } from '../config/courseGrpc';
import { emitToRecipient } from './realtime.service';

export type Recipient = { userId: string; email: string; fullName: string; role: string; recipientType?: RecipientType };
export type NotificationMetadata = { category: NotificationCategory; priority?: 'NORMAL' | 'HIGH'; actionUrl?: string; actionLabel?: string; data?: Record<string, unknown> };

class NotificationService {
  private recipientFilter(recipientType: RecipientType, userId: string) { return { recipientType, userId }; }

  async list(recipientType: RecipientType, userId: string, query: Record<string, unknown>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const filter: Record<string, unknown> = this.recipientFilter(recipientType, userId);
    if (query.type) filter.type = query.type;
    if (query.category) filter.category = query.category;
    if (query.read === 'true') filter.readAt = { $ne: null };
    if (query.read === 'false') filter.readAt = null;
    if (query.search) {
      const escaped = String(query.search).trim().split('').map(char => [36, 94, 46, 42, 43, 63, 40, 41, 91, 93, 123, 125, 124, 92].includes(char.charCodeAt(0)) ? String.fromCharCode(92) + char : char).join('');
      if (escaped) filter.$or = [{ title: { $regex: escaped, $options: 'i' } }, { body: { $regex: escaped, $options: 'i' } }];
    }
    const createdAt: Record<string, Date> = {};
    if (query.from) { const from = new Date(String(query.from) + 'T00:00:00.000+07:00'); if (!Number.isNaN(from.getTime())) createdAt.$gte = from; }
    if (query.to) { const to = new Date(String(query.to) + 'T23:59:59.999+07:00'); if (!Number.isNaN(to.getTime())) createdAt.$lte = to; }
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;
    const [items, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
  async recent(recipientType: RecipientType, userId: string) {
    return Notification.find(this.recipientFilter(recipientType, userId)).sort({ createdAt: -1 }).limit(5).lean();
  }
  async unreadCount(recipientType: RecipientType, userId: string) {
    return Notification.countDocuments({ ...this.recipientFilter(recipientType, userId), readAt: null });
  }
  async markRead(recipientType: RecipientType, userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Notification không hợp lệ.');
    const item = await Notification.findOneAndUpdate({ _id: id, ...this.recipientFilter(recipientType, userId) }, { $set: { readAt: new Date() } }, { new: true });
    if (!item) throw new Error('Notification không tồn tại.');
    emitToRecipient(recipientType, userId, 'notification:read', item.toObject());
    emitToRecipient(recipientType, userId, 'notification:unread-count', { count: await this.unreadCount(recipientType, userId) });
    return item;
  }
  async markAllRead(recipientType: RecipientType, userId: string) {
    const readAt = new Date();
    const result = await Notification.updateMany({ ...this.recipientFilter(recipientType, userId), readAt: null }, { $set: { readAt } });
    emitToRecipient(recipientType, userId, 'notification:read-all', { readAt: readAt.toISOString(), updated: result.modifiedCount });
    emitToRecipient(recipientType, userId, 'notification:unread-count', { count: 0 });
    return { updated: result.modifiedCount };
  }
  async createInApp(recipient: Recipient, event: string, title: string, body: string, sourceKey: string, metadata: NotificationMetadata) {
    const recipientType = recipient.recipientType || 'USER';
    try {
      const item = await Notification.create({ recipientType, userId: recipient.userId, type: event, title, body, sourceKey, category: metadata.category, priority: metadata.priority || 'NORMAL', actionUrl: metadata.actionUrl || '', actionLabel: metadata.actionLabel || '', data: metadata.data || {} });
      emitToRecipient(recipientType, recipient.userId, 'notification:new', item.toObject());
      emitToRecipient(recipientType, recipient.userId, 'notification:unread-count', { count: await this.unreadCount(recipientType, recipient.userId) });
      console.log(JSON.stringify({ level: 'info', event: 'notification.created', sourceKey, recipientType, userId: recipient.userId }));
      return item;
    } catch (error: any) {
      if (error?.code === 11000) return Notification.findOne({ recipientType, userId: recipient.userId, sourceKey });
      throw error;
    }
  }
  async getRecipients(request: Record<string, unknown>): Promise<Recipient[]> {
    const recipientType = String(request.recipientType || 'USER') as RecipientType;
    const result: Recipient[] = [];
    let page = 1;
    do {
      const response = await identityGrpcClient.listNotificationRecipients({ audience: String(request.audience || ''), email: String(request.email || ''), userId: String(request.userId || ''), recipientType, permission: String(request.permission || ''), page, limit: 200 });
      result.push(...response.recipients.map(item => ({ ...item, recipientType })));
      if (!response.hasMore) break;
      page += 1;
    } while (page < 1000);
    return result;
  }
  async getCourseRecipients(courseId: string): Promise<Recipient[]> {
    const result: Recipient[] = []; let page = 1;
    do {
      const response = await courseGrpcClient.listCourseNotificationRecipients({ courseId, page, limit: 200 });
      result.push(...response.recipients.map(item => ({ ...item, recipientType: 'USER' as const })));
      if (!response.hasMore) break;
      page += 1;
    } while (page < 1000);
    return result;
  }
  async sendEvent(event: string, recipient: Recipient, values: Record<string, unknown>, sourceKey: string, metadata: NotificationMetadata) {
    const recipientType = recipient.recipientType || 'USER';
    for (const type of ['IN_APP', 'EMAIL'] as const) {
      const enabled = await preferenceService.channelEnabled(recipientType, recipient.userId, metadata.category, type === 'EMAIL' ? 'email' : 'inApp');
      if (!enabled) continue;
      const template = await templateService.findActive(event, type);
      if (!template) continue;
      const title = renderTemplate(String(template.subject || template.name), values);
      const body = renderTemplate(String(template.body), values);
      if (type === 'IN_APP') await this.createInApp(recipient, event, title, body, sourceKey, metadata);
      else if (recipient.email) await emailService.enqueue({ deliveryKey: `${sourceKey}:EMAIL:${recipientType}:${recipient.userId}`, userId: recipient.userId, email: recipient.email, subject: title, body });
    }
  }
  async queueCampaign(adminId: string, input: Record<string, any>) {
    const audiences = ['ALL_LEARNERS', 'ALL_INSTRUCTORS', 'ALL_ADMINS', 'ALL_USERS', 'SPECIFIC_USER', 'COURSE_STUDENTS'];
    const channels: string[] = (input.channels || []).filter((value: string) => ['EMAIL', 'IN_APP'].includes(value));
    if (!audiences.includes(input.audience)) throw new Error('Đối tượng nhận không hợp lệ.');
    if (input.audience === 'SPECIFIC_USER' && !input.specificEmail?.trim()) throw new Error('Email người nhận là bắt buộc.');
    if (input.audience === 'COURSE_STUDENTS' && !input.courseId?.trim()) throw new Error('Khóa học là bắt buộc.');
    if (!input.title?.trim() || !input.content?.trim() || !channels.length) throw new Error('Tiêu đề, nội dung và kênh gửi là bắt buộc.');
    const allowedVariables = new Set(['userName', 'userEmail', ...(input.audience === 'COURSE_STUDENTS' ? ['courseId'] : [])]);
    const usedVariables = [...extractVariables(String(input.title || '')), ...extractVariables(String(input.content || ''))];
    const invalidVariables = [...new Set(usedVariables.filter(variable => !allowedVariables.has(variable)))];
    if (invalidVariables.length) throw new Error('Biến nội dung không hợp lệ: ' + invalidVariables.map(variable => '{{' + variable + '}}').join(', '));
    const campaign = await Campaign.create({ createdBy: adminId, audience: input.audience, specificEmail: input.specificEmail, courseId: input.courseId, title: input.title.trim(), content: input.content.trim(), channels, status: 'PROCESSING' });
    try {
      await publishMessage<NotificationCampaignRequestedPayload>(Exchange.NOTIFICATION, RoutingKey.NOTIFICATION_CAMPAIGN_REQUESTED, { campaignId: campaign.id });
    } catch (error) {
      campaign.status = 'FAILED'; await campaign.save(); throw error;
    }
    return campaign;
  }
  async processCampaign(campaignId: string) {
    const campaign: any = await Campaign.findOneAndUpdate({ _id: campaignId, status: 'PROCESSING', processingStartedAt: null }, { $set: { processingStartedAt: new Date() } }, { new: true });
    if (!campaign) return;
    try {
      const recipients = campaign.audience === 'COURSE_STUDENTS'
        ? await this.getCourseRecipients(campaign.courseId)
        : campaign.audience === 'ALL_ADMINS'
          ? await this.getRecipients({ audience: campaign.audience, recipientType: 'ADMIN' })
          : campaign.audience === 'ALL_USERS'
            ? [
                ...await this.getRecipients({ audience: campaign.audience, recipientType: 'USER' }),
                ...await this.getRecipients({ audience: campaign.audience, recipientType: 'ADMIN' }),
              ]
            : await this.getRecipients({ audience: campaign.audience, email: campaign.specificEmail || '', recipientType: 'USER' });
      const stats = { requested: recipients.length, inAppSent: 0, emailSent: 0, emailFailed: 0 };
      for (let offset = 0; offset < recipients.length; offset += 50) {
        for (const recipient of recipients.slice(offset, offset + 50)) {
          const values = { userName: recipient.fullName, userEmail: recipient.email, courseId: campaign.courseId || '' };
          const title = renderTemplate(campaign.title, values); const body = renderTemplate(campaign.content, values);
          const recipientType = recipient.recipientType || 'USER';
          if (campaign.channels.includes('IN_APP') && await preferenceService.channelEnabled(recipientType, recipient.userId, 'CAMPAIGN', 'inApp')) {
            await this.createInApp(recipient, 'MANUAL', title, body, `campaign:${campaign.id}`, { category: 'CAMPAIGN', data: { campaignId: campaign.id } });
            stats.inAppSent += 1;
          }
          if (campaign.channels.includes('EMAIL') && await preferenceService.channelEnabled(recipientType, recipient.userId, 'CAMPAIGN', 'email')) {
            await emailService.enqueue({ deliveryKey: `campaign:${campaign.id}:EMAIL:${recipientType}:${recipient.userId}`, campaignId: campaign.id, userId: recipient.userId, email: recipient.email, subject: title, body });
          }
        }
      }
      campaign.stats = stats;
      if (!campaign.channels.includes('EMAIL')) { campaign.status = 'COMPLETED'; campaign.completedAt = new Date(); }
      await campaign.save();
      if (campaign.channels.includes('EMAIL')) await emailService.refreshCampaign(campaign.id);
    } catch (error) { campaign.status = 'FAILED'; campaign.completedAt = new Date(); await campaign.save(); throw error; }
  }
  async retryCampaign(id: string) {
    const campaign = await Campaign.findById(id); if (!campaign) throw new Error('Campaign không tồn tại.');
    await DeliveryAttempt.updateMany({ campaignId: id, status: 'FAILED' }, { $set: { status: 'PENDING', attempts: 0, lastError: '', nextAttemptAt: new Date() }, $unset: { completedAt: 1 } });
    campaign.status = 'PROCESSING'; campaign.processingStartedAt = null; campaign.completedAt = undefined; await campaign.save();
    await publishMessage<NotificationCampaignRequestedPayload>(Exchange.NOTIFICATION, RoutingKey.NOTIFICATION_CAMPAIGN_REQUESTED, { campaignId: id });
    return campaign;
  }
  async listCampaigns(query: Record<string, unknown>) { const page = Math.max(1, Number(query.page) || 1); const limit = Math.min(50, Math.max(1, Number(query.limit) || 20)); const [items, total] = await Promise.all([Campaign.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Campaign.countDocuments()]); return { items, total, page, limit }; }
  async getCampaign(id: string) { const item = await Campaign.findById(id).lean(); if (!item) throw new Error('Campaign không tồn tại.'); const failures = await DeliveryAttempt.find({ campaignId: id, status: 'FAILED' }).select('email attempts lastError').lean(); return { ...item, failures }; }
}
export default new NotificationService();
