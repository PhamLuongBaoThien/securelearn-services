// ========================
// Payment Service Layer
// Mục đích:
// - tạo checkout cho giỏ hàng khóa học
// - tra cứu transaction
// - xử lý IPN/return theo VNPay
// - phát event sang course-service khi thanh toán thành công
// Hàm chính:
// - createCourseCheckout()
// - getTransactionForUser()
// - getTransactionByCodeForUser()
// - handleVnpayIpn()
// - failTransaction()
// ========================
import { randomUUID } from 'crypto';
import { PaymentMethod, PaymentProvider, PaymentStatus, type PaymentCourseSucceededPayload } from '@securelearn/common';
import { PaymentAttempt } from '../models/paymentAttempt.model';
import { PaymentTransaction, type PaymentCourseItem, type IPaymentTransaction } from '../models/paymentTransaction.model';
import { PaymentWebhookEvent } from '../models/paymentWebhookEvent.model';
import { publishPaymentCourseFailed, publishPaymentCourseSucceeded } from '../events/publishers';
import { buildVnpayPaymentUrl } from './vnpay/vnpay.builder';
import { verifyVnpaySignature } from './vnpay/vnpay.verifier';

type CheckoutRequest = {
  paymentMethod: PaymentMethod;
  provider?: PaymentProvider;
};

type CartResponse = {
  status: 'OK' | 'ERR';
  message?: string;
  data?: {
    items: Array<{
      _id: string;
      slug: string;
      title: string;
      price: number;
      thumbnail?: string;
      instructorName: string;
    }>;
    totalPrice: number;
  };
};

class PaymentService {
  private readonly courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:5002';
  private readonly clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

  public async createCourseCheckout(
    user: { userId: string; userRole: string; fullName: string; email: string },
    token: string,
    request: CheckoutRequest,
    clientIp: string
  ) {
    const cart = await this.fetchCart(token);
    if (cart.items.length === 0) {
      throw new Error('Giỏ hàng của bạn đang trống.');
    }

    const normalizedProvider = this.normalizeProvider(request.provider, request.paymentMethod);
    if (normalizedProvider !== 'VNPAY') {
      throw new Error('Hiện tại SecureLearn mới tích hợp VNPay cho phase thanh toán đầu tiên.');
    }

    const transactionCode = this.generateTransactionCode(normalizedProvider);
    const orderInfo = this.buildOrderInfo(user.fullName, cart.items);

    const transaction = await PaymentTransaction.create({
      transactionCode,
      userId: user.userId,
      userRole: user.userRole,
      fullName: user.fullName,
      email: user.email,
      items: cart.items,
      amount: cart.totalPrice,
      provider: normalizedProvider,
      paymentMethod: request.paymentMethod,
      status: 'PENDING' as PaymentStatus,
    });

    await PaymentAttempt.create({
      transactionId: transaction._id.toString(),
      transactionCode,
      userId: user.userId,
      action: 'CHECKOUT',
      provider: normalizedProvider,
      paymentMethod: request.paymentMethod,
      success: true,
      message: 'Created checkout session',
      rawPayload: { cartCount: cart.items.length, clientIp, orderInfo },
    });

    return {
      transaction: this.mapTransaction(transaction),
      paymentUrl: buildVnpayPaymentUrl({
        txnRef: transaction.transactionCode,
        amount: transaction.amount,
        orderInfo,
        ipAddr: clientIp || '127.0.0.1',
      }),
    };
  }

  public async getTransactionForUser(transactionId: string, userId: string) {
    const transaction = await this.findOwnedTransaction(transactionId, userId);
    return this.mapTransaction(transaction);
  }

  public async getTransactionByCodeForUser(transactionCode: string, userId: string) {
    const transaction = await this.findOwnedTransactionByCode(transactionCode, userId);
    return this.mapTransaction(transaction);
  }

  private async confirmTransaction(transactionId: string, user: { userId: string; userRole: string; fullName: string; email: string }, providerRef?: string) {
    const transaction = await this.findOwnedTransaction(transactionId, user.userId);

    if (transaction.status === 'SUCCEEDED') {
      return this.mapTransaction(transaction);
    }

    transaction.status = 'SUCCEEDED';
    transaction.providerRef = providerRef || transaction.providerRef || randomUUID();
    transaction.paidAt = new Date();
    transaction.failureReason = '';
    await transaction.save();

    await PaymentAttempt.create({
      transactionId: transaction._id.toString(),
      transactionCode: transaction.transactionCode,
      userId: user.userId,
      action: 'CONFIRM',
      provider: transaction.provider,
      paymentMethod: transaction.paymentMethod,
      success: true,
      message: 'Transaction confirmed',
      rawPayload: { providerRef: transaction.providerRef },
    });

    await publishPaymentCourseSucceeded(this.toSucceededPayload(transaction));
    return this.mapTransaction(transaction);
  }

  public async failTransaction(transactionId: string, userId: string, reason: string) {
    const transaction = await this.findOwnedTransaction(transactionId, userId);
    if (transaction.status === 'FAILED') {
      return this.mapTransaction(transaction);
    }

    transaction.status = 'FAILED';
    transaction.failedAt = new Date();
    transaction.failureReason = reason;
    await transaction.save();

    await PaymentAttempt.create({
      transactionId: transaction._id.toString(),
      transactionCode: transaction.transactionCode,
      userId,
      action: 'CONFIRM',
      provider: transaction.provider,
      paymentMethod: transaction.paymentMethod,
      success: false,
      message: reason,
      rawPayload: { reason },
    });

    await publishPaymentCourseFailed({
      transactionId: transaction._id.toString(),
      transactionCode: transaction.transactionCode,
      userId,
      provider: transaction.provider,
      paymentMethod: transaction.paymentMethod,
      amount: transaction.amount,
      reason,
      failedAt: new Date().toISOString(),
    });

    return this.mapTransaction(transaction);
  }

  public async handleVnpayIpn(payload: Record<string, unknown>) {
    const result = await this.processVnpayResult(payload, 'WEBHOOK');
    return { rspCode: result.rspCode, message: result.message };
  }

  public async handleVnpayReturn(payload: Record<string, unknown>) {
    const result = await this.processVnpayResult(payload, 'CONFIRM');
    if (!result.success) {
      throw new Error(result.message);
    }
    return result.data!;
  }

  private async processVnpayResult(payload: Record<string, unknown>, action: 'WEBHOOK' | 'CONFIRM') {
    if (!verifyVnpaySignature(payload)) {
      return { success: false, rspCode: '97', message: 'Chữ ký giao dịch không hợp lệ.' };
    }

    const transactionCode = String(payload.vnp_TxnRef || '');
    const responseCode = String(payload.vnp_ResponseCode || '');
    const transactionStatus = String(payload.vnp_TransactionStatus || '');
    const amount = Number(payload.vnp_Amount || 0) / 100;
    const transactionNo = String(payload.vnp_TransactionNo || '');
    const bankTranNo = String(payload.vnp_BankTranNo || '');
    const payDate = String(payload.vnp_PayDate || '');

    if (!transactionCode) {
      return { success: false, rspCode: '01', message: 'Thiếu mã giao dịch (vnp_TxnRef).' };
    }

    const transaction = await PaymentTransaction.findOne({ transactionCode });
    if (!transaction) {
      return { success: false, rspCode: '01', message: 'Giao dịch không tồn tại trên hệ thống.' };
    }

    const eventId = `${transactionCode}-${transactionNo || bankTranNo || 'na'}`;

    // Kiểm tra xem sự kiện IPN này đã từng được xử lý và ghi nhận thành công chưa (Idempotency)
    const existingWebhook = await PaymentWebhookEvent.findOne({ provider: 'VNPAY', eventId });
    if (existingWebhook) {
      return {
        success: true,
        rspCode: '00',
        message: 'Giao dịch đã được ghi nhận trước đó.',
        data: this.mapTransaction(transaction),
      };
    }

    if (Math.round(transaction.amount) !== Math.round(amount)) {
      return { success: false, rspCode: '04', message: 'Số tiền thanh toán không khớp với giao dịch.' };
    }

    // Trường hợp giao dịch đã ở trạng thái thành công trong DB (được xử lý bởi cổng kia trước)
    if (transaction.status === 'SUCCEEDED') {
      await PaymentWebhookEvent.create({
        provider: 'VNPAY',
        eventId,
        transactionCode,
        status: 'SUCCEEDED',
        processedAt: new Date(),
        rawPayload: payload,
      });
      return { success: true, rspCode: '00', message: 'Thành công', data: this.mapTransaction(transaction) };
    }

    // Kiểm tra kết quả thanh toán từ VNPay
    if (responseCode !== '00' || transactionStatus !== '00') {
      transaction.status = 'FAILED';
      transaction.failedAt = new Date();
      transaction.failureReason = `VNPay response code: ${responseCode}`;
      transaction.providerRef = transactionNo || bankTranNo || transaction.providerRef || randomUUID();
      await transaction.save();

      await PaymentAttempt.create({
        transactionId: transaction._id.toString(),
        transactionCode,
        userId: transaction.userId,
        action,
        provider: 'VNPAY',
        paymentMethod: transaction.paymentMethod,
        success: false,
        message: `VNPay response code: ${responseCode}`,
        rawPayload: payload,
      });

      await publishPaymentCourseFailed({
        transactionId: transaction._id.toString(),
        transactionCode,
        userId: transaction.userId,
        provider: 'VNPAY',
        paymentMethod: transaction.paymentMethod,
        amount: transaction.amount,
        reason: `VNPay response code: ${responseCode}`,
        failedAt: new Date().toISOString(),
      });

      await PaymentWebhookEvent.create({
        provider: 'VNPAY',
        eventId,
        transactionCode,
        status: 'FAILED',
        processedAt: new Date(),
        rawPayload: payload,
      });

      return {
        success: false,
        rspCode: '00',
        message: `Thanh toán thất bại từ VNPay (Mã phản hồi: ${responseCode}).`,
        data: this.mapTransaction(transaction),
      };
    }

    // Ghi nhận thanh toán thành công
    transaction.status = 'SUCCEEDED';
    transaction.providerRef = transactionNo || bankTranNo || transaction.providerRef || randomUUID();
    transaction.paidAt = payDate ? this.parseVnpayDate(payDate) : new Date();
    transaction.failureReason = '';
    await transaction.save();

    await PaymentAttempt.create({
      transactionId: transaction._id.toString(),
      transactionCode,
      userId: transaction.userId,
      action,
      provider: 'VNPAY',
      paymentMethod: transaction.paymentMethod,
      success: true,
      message: `VNPay ${action} success`,
      rawPayload: payload,
    });

    await publishPaymentCourseSucceeded(this.toSucceededPayload(transaction));

    await PaymentWebhookEvent.create({
      provider: 'VNPAY',
      eventId,
      transactionCode,
      status: 'SUCCEEDED',
      processedAt: new Date(),
      rawPayload: payload,
    });

    return {
      success: true,
      rspCode: '00',
      message: 'Thành công',
      data: this.mapTransaction(transaction),
    };
  }

  private async fetchCart(token: string): Promise<{ items: PaymentCourseItem[]; totalPrice: number }> {
    const response = await fetch(`${this.courseServiceUrl}/api/cart`, {
      headers: {
        Authorization: token,
      },
    });

    const data = (await response.json()) as CartResponse;
    if (!response.ok || data.status === 'ERR') {
      throw new Error(data.message || 'Không thể lấy giỏ hàng để thanh toán.');
    }

    return {
      items: (data.data?.items || []).map((item) => this.toPaymentItem(item)),
      totalPrice: data.data?.totalPrice || 0,
    };
  }

  private async findOwnedTransaction(transactionId: string, userId: string): Promise<IPaymentTransaction> {
    const transaction = await PaymentTransaction.findById(transactionId);
    if (!transaction) {
      throw new Error('Giao dịch không tồn tại.');
    }
    if (transaction.userId !== userId) {
      throw new Error('Bạn không có quyền truy cập giao dịch này.');
    }
    return transaction;
  }

  private async findOwnedTransactionByCode(transactionCode: string, userId: string): Promise<IPaymentTransaction> {
    const transaction = await PaymentTransaction.findOne({ transactionCode });
    if (!transaction) {
      throw new Error('Giao dịch không tồn tại.');
    }
    if (transaction.userId !== userId) {
      throw new Error('Bạn không có quyền truy cập giao dịch này.');
    }
    return transaction;
  }

  private mapTransaction(transaction: IPaymentTransaction) {
    return {
      _id: transaction._id.toString(),
      transactionCode: transaction.transactionCode,
      userId: transaction.userId,
      userRole: transaction.userRole,
      fullName: transaction.fullName,
      email: transaction.email,
      items: transaction.items,
      amount: transaction.amount,
      provider: transaction.provider,
      paymentMethod: transaction.paymentMethod,
      status: transaction.status,
      providerRef: transaction.providerRef || '',
      failureReason: transaction.failureReason || '',
      paidAt: transaction.paidAt || null,
      failedAt: transaction.failedAt || null,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  private toPaymentItem(item: { _id: string; slug: string; title: string; price: number; thumbnail?: string; instructorName?: string }): PaymentCourseItem {
    return {
      courseId: item._id,
      slug: item.slug,
      title: item.title,
      price: item.price,
      thumbnail: item.thumbnail,
      instructorName: item.instructorName,
    };
  }

  private toSucceededPayload(transaction: IPaymentTransaction): PaymentCourseSucceededPayload {
    return {
      transactionId: transaction._id.toString(),
      transactionCode: transaction.transactionCode,
      userId: transaction.userId,
      userRole: transaction.userRole,
      fullName: transaction.fullName,
      email: transaction.email,
      provider: transaction.provider,
      paymentMethod: transaction.paymentMethod,
      amount: transaction.amount,
      items: transaction.items,
      paidAt: (transaction.paidAt || new Date()).toISOString(),
    };
  }

  private generateTransactionCode(provider: PaymentProvider): string {
    const prefix = provider === 'MOMO' ? 'MM' : provider === 'VNPAY' ? 'VNP' : 'PM';
    return `${prefix}${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`;
  }

  private normalizeProvider(provider: PaymentProvider | undefined, paymentMethod: PaymentMethod): PaymentProvider {
    if (provider) return provider;
    return paymentMethod === 'MOMO' ? 'MOMO' : 'VNPAY';
  }

  private buildOrderInfo(fullName: string, items: PaymentCourseItem[]): string {
    const titles = items.map((item) => item.title).slice(0, 3);
    const summary = titles.join(', ');
    const suffix = items.length > 3 ? ` và ${items.length - 3} khóa học khác` : '';
    return `SecureLearn thanh toan khoa hoc cho ${fullName}${summary ? `: ${summary}${suffix}` : ''}`;
  }

  private parseVnpayDate(value: string): Date {
    if (!/^\d{14}$/.test(value)) {
      return new Date();
    }
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(8, 10));
    const minute = Number(value.slice(10, 12));
    const second = Number(value.slice(12, 14));
    return new Date(Date.UTC(year, month, day, hour - 7, minute, second));
  }
}

export default new PaymentService();
