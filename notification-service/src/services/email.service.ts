import nodemailer from 'nodemailer';
import { DeliveryAttempt } from '../models/deliveryAttempt.model';
const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
class EmailService {
    async send(input: {
        deliveryKey: string;
        campaignId?: string;
        userId: string;
        email: string;
        subject: string;
        body: string;
    }) {
        const attempt = await DeliveryAttempt.findOneAndUpdate({ deliveryKey: input.deliveryKey }, { $setOnInsert: { ...input, status: 'PENDING' } }, { new: true, upsert: true });
        if (attempt.status === 'SENT')
            return true;
        attempt.subject = input.subject;
        attempt.body = input.body;
        for (let i = attempt.attempts; i < 3; i++) {
            try {
                attempt.attempts = i + 1;
                await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: input.email, subject: input.subject, text: input.body });
                attempt.status = 'SENT';
                attempt.sentAt = new Date();
                attempt.lastError = '';
                await attempt.save();
                return true;
            }
            catch (error: any) {
                attempt.attempts = i + 1;
                attempt.lastError = error.message;
                attempt.status = 'FAILED';
                await attempt.save();
                if (i < 2)
                    await wait(250 * Math.pow(2, i));
            }
        }
        return false;
    }
}
export default new EmailService();

