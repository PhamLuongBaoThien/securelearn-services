import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

class MailerService {
  private async sendOTP(to: string, otp: string, title: string, description: string): Promise<void> {
    try {
      await transporter.sendMail({ from: `"SecureLearn Support" <${process.env.SMTP_USER}>`, to, subject: title, html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>${title}</h2><p>${description}</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:20px;background:#f4f4f5;text-align:center">${otp}</div><p>Mã có hiệu lực trong 5 phút.</p></div>` });
    } catch { throw new Error('Lỗi xảy ra khi gửi email, vui lòng thử lại sau.'); }
  }
  public sendRegistrationOTP(to: string, otp: string): Promise<void> { return this.sendOTP(to, otp, 'Xác nhận đăng ký SecureLearn', 'Nhập mã dưới đây để hoàn tất tạo tài khoản.'); }

  /**
   * Gửi email OTP khôi phục mật khẩu
   * @param to Địa chỉ email người nhận
   * @param otp Mã OTP gồm 6 chữ số
   */
  public async sendPasswordResetOTP(to: string, otp: string): Promise<void> {
    try {
      const mailOptions = {
        from: `"SecureLearn Support" <${process.env.SMTP_USER}>`,
        to,
        subject: 'Khôi phục mật khẩu của bạn',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 10px; overflow: hidden;">
            <div style="background-color: #0f172a; padding: 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0;">SecureLearn</h1>
            </div>
            <div style="padding: 30px;">
              <h2 style="color: #333; margin-top: 0;">Yêu cầu khôi phục mật khẩu</h2>
              <p style="color: #555; line-height: 1.6;">
                Bạn vừa yêu cầu khôi phục mật khẩu trên hệ thống SecureLearn. Dưới đây là mã xác thực <strong>OTP</strong> của bạn:
              </p>
              <div style="margin: 30px 0; text-align: center;">
                <span style="display: inline-block; font-size: 32px; font-weight: bold; color: #0284c7; background-color: #f0f9ff; padding: 15px 30px; border-radius: 8px; border: 1px dashed #0284c7; letter-spacing: 4px;">
                  ${otp}
                </span>
              </div>
              <p style="color: #555; line-height: 1.6;">
                Mã này có hiệu lực trong vòng <strong>5 phút</strong>. Vui lòng không chia sẻ mã này cho bất kỳ ai.
              </p>
              <p style="color: #777; font-size: 14px; margin-top: 30px;">
                Nếu bạn không thức hiện yêu cầu này, xin vui lòng bỏ qua email này hoặc liên lạc với bộ phận hỗ trợ.
              </p>
            </div>
            <div style="background-color: #f8fafc; padding: 15px; text-align: center; color: #888; font-size: 12px;">
              &copy; ${new Date().getFullYear()} SecureLearn. Vững bước tương lai.
            </div>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      console.log(`[Mail Service] Đã gửi OTP đến ${to}`);
    } catch (error: any) {
      console.error('[Mail Service Error]', error);
      throw new Error('Lỗi xảy ra khi gửi email, vui lòng thử lại sau.');
    }
  }
}

export default new MailerService();
