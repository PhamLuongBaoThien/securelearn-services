// ========================
// Payment Service Layer
// Mục đích:
// - tạo checkout cho giỏ hàng khóa học
// - tra cứu transaction
// - xử lý IPN/return theo VNPay và MoMo
// - phát event sang course-service khi thanh toán thành công
// Hàm chính:
// - createCourseCheckout()
// - getTransactionForUser()
// - getTransactionByCodeForUser()
// - handleVnpayIpn()
// - handleMomoIpn()
// - handleMomoReturn()
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
import { createMomoPaymentSession, queryMomoTransaction } from './momo/momo.client';
import { verifyMomoSignature } from './momo/momo.verifier';
import { getMomoConfig } from './momo/momo.config';

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

    let paymentUrl = '';

    try {
      if (normalizedProvider === 'MOMO') {
        const momoConfig = getMomoConfig();
        paymentUrl = await this.createMomoCheckoutUrl({
          orderId: transaction.transactionCode,
          amount: transaction.amount,
          orderInfo,
          redirectUrl: momoConfig.returnUrl,
          ipnUrl: momoConfig.ipnUrl,
          items: this.toMomoItems(cart.items),
          userInfo: { name: user.fullName, email: user.email },
        });
      } else {
        paymentUrl = buildVnpayPaymentUrl({
          txnRef: transaction.transactionCode,
          amount: transaction.amount,
          orderInfo,
          ipAddr: clientIp || '127.0.0.1',
        });
      }

      await PaymentAttempt.create({
        transactionId: transaction._id.toString(),
        transactionCode,
        userId: user.userId,
        action: 'CHECKOUT',
        provider: normalizedProvider,
        paymentMethod: request.paymentMethod,
        success: true,
        message: 'Created checkout session',
        rawPayload: { cartCount: cart.items.length, clientIp, orderInfo, paymentUrl },
      });
    } catch (error: any) {
      transaction.status = 'FAILED';
      transaction.failedAt = new Date();
      transaction.failureReason = error.message || 'Không thể tạo phiên thanh toán.';
      await transaction.save();

      await PaymentAttempt.create({
        transactionId: transaction._id.toString(),
        transactionCode,
        userId: user.userId,
        action: 'CHECKOUT',
        provider: normalizedProvider,
        paymentMethod: request.paymentMethod,
        success: false,
        message: error.message || 'Không thể tạo phiên thanh toán.',
        rawPayload: { cartCount: cart.items.length, clientIp, orderInfo },
      });

      throw error;
    }

    return {
      transaction: this.mapTransaction(transaction),
      paymentUrl,
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

  public async handleMomoIpn(payload: Record<string, unknown>) {
    const result = await this.processMomoResult(payload, 'WEBHOOK');
    return result;
  }

  public async handleMomoReturn(payload: Record<string, unknown>) {
    const result = await this.processMomoResult(payload, 'CONFIRM');
    if (result.success) {
      return result.data!;
    }

    const orderId = String(payload.orderId || payload.order_id || '');
    if (!orderId) {
      throw new Error(result.message);
    }

    const reconciled = await this.reconcileMomoTransaction(orderId);
    if (!reconciled.success) {
      throw new Error(reconciled.message);
    }

    return reconciled.data!;
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

  private async processMomoResult(payload: Record<string, unknown>, action: 'WEBHOOK' | 'CONFIRM' | 'QUERY') {
    const orderId = String(payload.orderId || payload.order_id || '');
    if (!orderId) {
      return { success: false, message: 'Thiếu mã đơn hàng (orderId).' };
    }

    if (action !== 'QUERY' && !verifyMomoSignature(payload)) {
      return { success: false, message: 'Chữ ký giao dịch MoMo không hợp lệ.' };
    }

    const transaction = await PaymentTransaction.findOne({ transactionCode: orderId });
    if (!transaction) {
      return { success: false, message: 'Giao dịch không tồn tại trên hệ thống.' };
    }

    const resultCode = Number(payload.resultCode ?? payload.result_code ?? -1);
    const amount = Number(payload.amount ?? 0);
    const requestId = String(payload.requestId || payload.request_id || '');
    const transId = String(payload.transId || payload.trans_id || '');
    const responseTime = String(payload.responseTime || payload.response_time || '');
    const eventId = `${orderId}-${transId || requestId || 'na'}`;

    const existingWebhook = await PaymentWebhookEvent.findOne({ provider: 'MOMO', eventId });
    if (existingWebhook) {
      return {
        success: true,
        message: 'Giao dịch đã được ghi nhận trước đó.',
        data: this.mapTransaction(transaction),
      };
    }

    if (Math.round(transaction.amount) !== Math.round(amount)) {
      return { success: false, message: 'Số tiền thanh toán không khớp với giao dịch.' };
    }

    if (transaction.status === 'SUCCEEDED') {
      await PaymentWebhookEvent.create({
        provider: 'MOMO',
        eventId,
        transactionCode: orderId,
        status: 'SUCCEEDED',
        processedAt: new Date(),
        rawPayload: payload,
      });

      return { success: true, message: 'Thành công', data: this.mapTransaction(transaction) };
    }

    if (![0, 9000].includes(resultCode)) {
      transaction.status = 'FAILED';
      transaction.failedAt = new Date();
      transaction.failureReason = String(payload.message || 'Thanh toán MoMo thất bại.');
      transaction.providerRef = transId || transaction.providerRef || randomUUID();
      await transaction.save();

      await PaymentAttempt.create({
        transactionId: transaction._id.toString(),
        transactionCode: orderId,
        userId: transaction.userId,
        action,
        provider: 'MOMO',
        paymentMethod: transaction.paymentMethod,
        success: false,
        message: transaction.failureReason,
        rawPayload: payload,
      });

      await publishPaymentCourseFailed({
        transactionId: transaction._id.toString(),
        transactionCode: transaction.transactionCode,
        userId: transaction.userId,
        provider: 'MOMO',
        paymentMethod: transaction.paymentMethod,
        amount: transaction.amount,
        reason: transaction.failureReason,
        failedAt: new Date().toISOString(),
      });

      await PaymentWebhookEvent.create({
        provider: 'MOMO',
        eventId,
        transactionCode: orderId,
        status: 'FAILED',
        processedAt: new Date(),
        rawPayload: payload,
      });

      return {
        success: false,
        message: `Thanh toán MoMo thất bại (Mã phản hồi: ${resultCode}).`,
        data: this.mapTransaction(transaction),
      };
    }

    transaction.status = 'SUCCEEDED';
    transaction.providerRef = transId || transaction.providerRef || randomUUID();
    transaction.paidAt = responseTime ? new Date(Number(responseTime)) : new Date();
    transaction.failureReason = '';
    await transaction.save();

    await PaymentAttempt.create({
      transactionId: transaction._id.toString(),
      transactionCode: orderId,
      userId: transaction.userId,
      action,
      provider: 'MOMO',
      paymentMethod: transaction.paymentMethod,
      success: true,
      message: `MoMo ${action} success`,
      rawPayload: payload,
    });

    await publishPaymentCourseSucceeded(this.toSucceededPayload(transaction));

    await PaymentWebhookEvent.create({
      provider: 'MOMO',
      eventId,
      transactionCode: orderId,
      status: 'SUCCEEDED',
      processedAt: new Date(),
      rawPayload: payload,
    });

    return {
      success: true,
      message: 'Thành công',
      data: this.mapTransaction(transaction),
    };
  }

  private async reconcileMomoTransaction(orderId: string) {
    const response = await queryMomoTransaction(orderId);
    const payload: Record<string, unknown> = {
      ...response,
      orderId: response.orderId || orderId,
    };

    return this.processMomoResult(payload, 'QUERY');
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

  private async createMomoCheckoutUrl(input: {
    orderId: string;
    amount: number;
    orderInfo: string;
    redirectUrl: string;
    ipnUrl: string;
    items: Array<{
      id: string;
      name: string;
      description: string;
      imageUrl?: string;
      price: number;
      quantity: number;
      totalPrice: number;
      category?: string;
      unit?: string;
      taxAmount?: number;
    }>;
    userInfo: {
      name: string;
      email?: string;
      phoneNumber?: string;
    };
  }) {
    const session = await createMomoPaymentSession({
      orderId: input.orderId,
      amount: input.amount,
      orderInfo: input.orderInfo,
      redirectUrl: input.redirectUrl,
      ipnUrl: input.ipnUrl,
      orderExpireTime: Number(process.env.MOMO_ORDER_EXPIRE_TIME || '30'),
      items: input.items,
      userInfo: input.userInfo,
    });

    if (!session.payUrl) {
      throw new Error('MoMo không trả về đường dẫn thanh toán.');
    }

    return session.payUrl;
  }

  private toMomoItems(items: PaymentCourseItem[]) {
    return items.map((item) => ({
      id: item.courseId,
      name: item.title,
      description: item.title,
      imageUrl: item.thumbnail || 'https://placehold.co/300x300/png?text=SecureLearn',
      price: Math.round(item.price),
      quantity: 1,
      totalPrice: Math.round(item.price),
      category: 'education',
      unit: 'course',
      taxAmount: 0,
    }));
  }
}

export default new PaymentService();
