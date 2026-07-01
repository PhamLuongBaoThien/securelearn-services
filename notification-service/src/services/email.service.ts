import nodemailer from 'nodemailer';
import { DeliveryAttempt } from '../models/deliveryAttempt.model';
import { Campaign } from '../models/campaign.model';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000];
let workerTimer: NodeJS.Timeout | null = null;
let working = false;

class EmailService {
  async enqueue(input: {
    deliveryKey: string;
    campaignId?: string;
    userId: string;
    email: string;
    subject: string;
    body: string;
  }) {
    const attempt = await DeliveryAttempt.findOneAndUpdate(
      { deliveryKey: input.deliveryKey },
      { $setOnInsert: { ...input, status: 'PENDING', attempts: 0, nextAttemptAt: new Date() } },
      { new: true, upsert: true },
    );
    console.log(JSON.stringify({ level: 'info', event: 'email.queued', deliveryKey: input.deliveryKey, userId: input.userId }));
    return attempt;
  }

  startWorker() {
    if (workerTimer) return;
    void DeliveryAttempt.updateMany({ status: 'PROCESSING' }, { $set: { status: 'PENDING', nextAttemptAt: new Date() } });
    workerTimer = setInterval(() => void this.processNext(), 1000);
    void this.processNext();
  }

  stopWorker() {
    if (workerTimer) clearInterval(workerTimer);
    workerTimer = null;
  }

  private async processNext() {
    if (working) return;
    working = true;
    try {
      const attempt = await DeliveryAttempt.findOneAndUpdate(
        { status: 'PENDING', nextAttemptAt: { $lte: new Date() } },
        { $set: { status: 'PROCESSING' } },
        { new: true, sort: { nextAttemptAt: 1 } },
      );
      if (!attempt) return;

      const limit = Math.max(1, Number(process.env.EMAIL_RETRY_LIMIT || 3));
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: attempt.email,
          subject: attempt.subject,
          text: attempt.body,
        });
        attempt.attempts += 1;
        attempt.status = 'SENT';
        attempt.sentAt = new Date();
        attempt.completedAt = new Date();
        attempt.lastError = '';
        await attempt.save();
        console.log(JSON.stringify({ level: 'info', event: 'email.sent', deliveryKey: attempt.deliveryKey, attempts: attempt.attempts }));
      } catch (error) {
        attempt.attempts += 1;
        attempt.lastError = error instanceof Error ? error.message : String(error);
        if (attempt.attempts >= limit) {
          attempt.status = 'FAILED';
          attempt.completedAt = new Date();
        } else {
          attempt.status = 'PENDING';
          attempt.nextAttemptAt = new Date(Date.now() + retryDelaysMs[Math.min(attempt.attempts - 1, retryDelaysMs.length - 1)]);
        }
        await attempt.save();
        console.error(JSON.stringify({ level: 'error', event: 'email.failed', deliveryKey: attempt.deliveryKey, attempts: attempt.attempts, final: attempt.status === 'FAILED', message: attempt.lastError }));
      }

      if (attempt.campaignId) await this.refreshCampaign(attempt.campaignId);
    } finally {
      working = false;
    }
  }

  async refreshCampaign(campaignId: string) {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return;
    const [pending, sent, failed] = await Promise.all([
      DeliveryAttempt.countDocuments({ campaignId, status: { $in: ['PENDING', 'PROCESSING'] } }),
      DeliveryAttempt.countDocuments({ campaignId, status: 'SENT' }),
      DeliveryAttempt.countDocuments({ campaignId, status: 'FAILED' }),
    ]);
    const current = campaign.stats || { requested: 0, inAppSent: 0, emailSent: 0, emailFailed: 0 };
    campaign.stats = { requested: current.requested || 0, inAppSent: current.inAppSent || 0, emailSent: sent, emailFailed: failed };
    if (pending === 0 && campaign.processingStartedAt) {
      campaign.status = failed > 0 ? 'PARTIAL' : 'COMPLETED';
      campaign.completedAt = new Date();
    }
    await campaign.save();
  }
}

export default new EmailService();