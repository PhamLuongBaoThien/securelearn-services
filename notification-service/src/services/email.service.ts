/**
 * Hàng đợi gửi email của notification-service.
 * Luồng hoạt động: notification.service render template -> enqueue tạo DeliveryAttempt
 * PENDING -> worker lấy từng bản ghi -> gửi SMTP -> đánh dấu SENT hoặc lên lịch retry
 * -> đồng bộ thống kê Campaign nếu email thuộc một chiến dịch của quản trị viên.
 */
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

const mailFrom = process.env.SMTP_FROM || `"SecureLearn" <${process.env.SMTP_USER}>`;

/** Escape dữ liệu template trước khi chèn vào HTML để nội dung không trở thành markup. */
const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

/** Bọc tiêu đề và nội dung notification trong mẫu HTML nhận diện SecureLearn. */
const buildEmailHtml = (subject: string, body: string) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="background:#0f172a;padding:20px;text-align:center">
      <h1 style="color:#ffffff;font-size:24px;margin:0">SecureLearn</h1>
    </div>
    <div style="padding:28px">
      <h2 style="color:#111827;font-size:20px;margin:0 0 16px">${escapeHtml(subject)}</h2>
      <p style="color:#4b5563;line-height:1.7;margin:0;white-space:pre-line">${escapeHtml(body)}</p>
    </div>
    <div style="background:#f8fafc;padding:14px;text-align:center;color:#6b7280;font-size:12px">
      &copy; ${new Date().getFullYear()} SecureLearn
    </div>
  </div>
`;

class EmailService {
  /**
   * Ghi một yêu cầu gửi email vào MongoDB theo deliveryKey duy nhất.
   * Upsert giúp cùng một event được xử lý lại nhưng không tạo email trùng lặp.
   */
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

  /** Khởi động worker nền; phục hồi job PROCESSING dang dở rồi kiểm tra hàng đợi mỗi giây. */
  startWorker() {
    if (workerTimer) return;
    void DeliveryAttempt.updateMany({ status: 'PROCESSING' }, { $set: { status: 'PENDING', nextAttemptAt: new Date() } });
    workerTimer = setInterval(() => void this.processNext(), 1000);
    void this.processNext();
  }

  /** Dừng timer của worker khi service shutdown để tiến trình thoát an toàn. */
  stopWorker() {
    if (workerTimer) clearInterval(workerTimer);
    workerTimer = null;
  }

  /**
   * Lấy job PENDING đến hạn sớm nhất và gửi qua SMTP. Khi lỗi, job được retry theo
   * các mốc 1/5/30 phút cho đến EMAIL_RETRY_LIMIT rồi chuyển thành FAILED.
   */
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
          from: mailFrom,
          to: attempt.email,
          subject: attempt.subject,
          text: attempt.body,
          html: buildEmailHtml(attempt.subject, attempt.body),
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

  /** Tổng hợp trạng thái DeliveryAttempt để cập nhật số email gửi thành công/thất bại của campaign. */
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
