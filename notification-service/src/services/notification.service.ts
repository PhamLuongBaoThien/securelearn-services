import { Types } from 'mongoose';
import { Notification } from '../models/notification.model';
import { Campaign } from '../models/campaign.model';
import templateService, { renderTemplate } from './template.service';
import emailService from './email.service';
import { identityGrpcClient } from '../config/identityGrpc';

export type Recipient = {
  userId: string;
  email: string;
  fullName: string;
  role: string;
};

class NotificationService {
  public async list(userId: string, query: Record<string, unknown>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const filter: Record<string, unknown> = { userId };
    if (query.type) filter.type = query.type;
    if (query.read === 'true') filter.readAt = { $ne: null };
    if (query.read === 'false') filter.readAt = null;

    const [items, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  public async unreadCount(userId: string) {
    return Notification.countDocuments({ userId, readAt: null });
  }

  public async markRead(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Notification không hợp lệ.');
    const item = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!item) throw new Error('Notification không tồn tại.');
    return item;
  }

  public async markAllRead(userId: string) {
    const result = await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
    return { updated: result.modifiedCount };
  }

  public async createInApp(
    recipient: Recipient,
    event: string,
    title: string,
    body: string,
    sourceKey: string,
    data: Record<string, unknown> = {},
  ) {
    return Notification.findOneAndUpdate(
      { userId: recipient.userId, sourceKey },
      { $setOnInsert: { userId: recipient.userId, type: event, title, body, data, sourceKey } },
      { new: true, upsert: true },
    );
  }

  public async getRecipients(request: Record<string, unknown>): Promise<Recipient[]> {
    const result: Recipient[] = [];
    let page = 1;
    do {
      const response = await identityGrpcClient.listNotificationRecipients({ audience: String(request.audience || ''), email: String(request.email || ''), userId: String(request.userId || ''), page, limit: 200 });
      result.push(...response.recipients);
      if (!response.hasMore) break;
      page += 1;
    } while (page < 1000);
    return result;
  }

  public async sendEvent(event: string, recipient: Recipient, values: Record<string, unknown>, sourceKey: string) {
    for (const type of ['IN_APP', 'EMAIL']) {
      const template = await templateService.findActive(event, type);
      if (!template) continue;
      const title = renderTemplate(String(template.subject || template.name), values);
      const body = renderTemplate(String(template.body), values);
      if (type === 'IN_APP') {
        await this.createInApp(recipient, event, title, body, sourceKey, values);
      } else {
        await emailService.send({
          deliveryKey: `${sourceKey}:EMAIL:${recipient.userId}`,
          userId: recipient.userId,
          email: recipient.email,
          subject: title,
          body,
        });
      }
    }
  }

  public async createCampaign(adminId: string, input: Record<string, any>) {
    const channels: string[] = (input.channels || []).filter((value: string) => ['EMAIL', 'IN_APP'].includes(value));
    const audiences = ['ALL_STUDENTS', 'ALL_INSTRUCTORS', 'ALL_USERS', 'SPECIFIC_USER'];
    if (!audiences.includes(input.audience)) throw new Error('Đối tượng nhận không hợp lệ.');
    if (input.audience === 'SPECIFIC_USER' && !input.specificEmail?.trim()) throw new Error('Email người nhận là bắt buộc.');
    if (!input.title?.trim() || !input.content?.trim() || !channels.length) {
      throw new Error('Tiêu đề, nội dung và kênh gửi là bắt buộc.');
    }

    const campaign = await Campaign.create({
      createdBy: adminId,
      audience: input.audience,
      specificEmail: input.specificEmail,
      title: input.title.trim(),
      content: input.content.trim(),
      channels,
    });
    const recipients = await this.getRecipients({ audience: input.audience, email: input.specificEmail || '' });
    const stats = campaign.stats!;
    stats.requested = recipients.length;

    for (const recipient of recipients) {
      const values = { userName: recipient.fullName, userEmail: recipient.email };
      const title = renderTemplate(campaign.title, values);
      const body = renderTemplate(campaign.content, values);
      if (channels.includes('IN_APP')) {
        await this.createInApp(recipient, 'MANUAL', title, body, `campaign:${campaign.id}`, { campaignId: campaign.id });
        stats.inAppSent += 1;
      }
      if (channels.includes('EMAIL')) {
        const sent = await emailService.send({
          deliveryKey: `campaign:${campaign.id}:EMAIL:${recipient.userId}`,
          campaignId: campaign.id,
          userId: recipient.userId,
          email: recipient.email,
          subject: title,
          body,
        });
        sent ? stats.emailSent += 1 : stats.emailFailed += 1;
      }
    }

    campaign.status = stats.emailFailed ? 'PARTIAL' : 'COMPLETED';
    await campaign.save();
    return campaign;
  }

  public async listCampaigns(query: Record<string, unknown>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const [items, total] = await Promise.all([
      Campaign.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Campaign.countDocuments(),
    ]);
    return { items, total, page, limit };
  }

  public async getCampaign(id: string) {
    const item = await Campaign.findById(id).lean();
    if (!item) throw new Error('Campaign không tồn tại.');
    return item;
  }
}

export default new NotificationService();