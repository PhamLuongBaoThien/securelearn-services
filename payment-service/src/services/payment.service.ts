// ========================
// Payment Service
// Mục đích:
// - xử lý checkout, callback và tra cứu transaction cho mua khóa học và thuê bao
// - snapshot chia doanh thu tại thời điểm thanh toán để downstream đọc số liệu ổn định
// - phát event hoặc tạo subscription term tùy theo productType của giao dịch
// ========================
import { randomUUID } from 'crypto';
import { PaymentMethod, PaymentProvider, PaymentStatus, type PaymentCourseSucceededPayload } from '@securelearn/common';
import { PaymentAttempt } from '../models/paymentAttempt.model';
import { PaymentTransaction, type PaymentCourseItem, type IPaymentTransaction } from '../models/paymentTransaction.model';
import { FinanceConfig } from '../models/financeConfig.model';
import { PaymentWebhookEvent } from '../models/paymentWebhookEvent.model';
import { publishPaymentCourseFailed, publishPaymentCourseSucceeded } from '../events/publishers';
import { buildVnpayPaymentUrl } from './vnpay/vnpay.builder';
import { verifyVnpaySignature } from './vnpay/vnpay.verifier';
import { createMomoPaymentSession, queryMomoTransaction } from './momo/momo.client';
import { verifyMomoSignature } from './momo/momo.verifier';
import { getMomoConfig } from './momo/momo.config';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import subscriptionService from './subscription.service';

type CheckoutRequest = {
  paymentMethod: PaymentMethod;
  provider?: PaymentProvider;
};

type SubscriptionCheckoutRequest = CheckoutRequest & {
  planId: string;
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
      instructorId: string;
    }>;
    totalPrice: number;
  };
};

type RevenueSplitConfig = {
  adminPercent: number;
  instructorPercent: number;
};

class PaymentService {
  private readonly courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:5002';
  private readonly clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  private readonly financeConfigKey = 'COURSE_REVENUE_SPLIT';
  private readonly momoPendingResultCodes = new Set([1000, 7000, 7002]);

  public async createCourseCheckout(
    user: { userId: string; userRole: string; fullName: string; email: string },
    token: string,
    request: CheckoutRequest,
    clientIp: string
  ) {
    // Entry chính của flow mua đứt.
    // Hàm này đọc cart hiện tại, tạo PaymentTransaction PENDING và sinh URL thanh toán cho VNPay hoặc MoMo.
    const cart = await this.fetchCart(token);
    if (cart.items.length === 0) {
      throw new Error('Giỏ hàng của bạn đang trống.');
    }

    // Chuẩn hóa provider để dễ quản lý sau này khi thêm cổng thanh toán mới hoặc phương thức thanh toán mới.
    const normalizedProvider = this.normalizeProvider(request.provider, request.paymentMethod);

    // Snapshot config chia doanh thu tại thời điểm checkout để đảm bảo tính nhất quán của transaction dù config có thể thay đổi sau này.
    const transactionCode = this.generateTransactionCode(normalizedProvider);
    const orderInfo = this.buildOrderInfo(transactionCode, cart.items.length);
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

  public async createSubscriptionCheckout(
    user: { userId: string; userRole: string; fullName: string; email: string },
    request: SubscriptionCheckoutRequest,
    clientIp: string
  ) {
    if (user.userRole === 'ADMIN') {
      throw new Error('Tài khoản Admin không thể mua gói thuê bao.');
    }
    if (!['STUDENT', 'INSTRUCTOR'].includes(user.userRole)) {
      throw new Error('Tài khoản này không được phép mua gói thuê bao.');
    }

    await subscriptionService.ensureDefaultPlans();
    const plan = await SubscriptionPlan.findOne({ _id: request.planId, isActive: true });
    if (!plan) throw new Error('Gói thuê bao không tồn tại hoặc đã ngừng bán.');

    const normalizedProvider = this.normalizeProvider(request.provider, request.paymentMethod);
    // Snapshot tỷ lệ chia ngay tại checkout để config đổi sau này không làm lệch giao dịch cũ.
    const split = await this.ensureFinanceSplitConfig();
    const adminAmount = this.calculateSplitAmount(plan.price, split.adminPercent);
    const transactionCode = this.generateTransactionCode(normalizedProvider);
    const orderInfo = `SecureLearn subscription ${plan.type} ${transactionCode}`;
    const transaction = await PaymentTransaction.create({
      transactionCode,
      userId: user.userId,
      userRole: user.userRole,
      fullName: user.fullName,
      email: user.email,
      items: [],
      amount: plan.price,
      productType: 'SUBSCRIPTION',
      subscriptionSnapshot: {
        planId: plan._id.toString(),
        planType: plan.type,
        name: plan.name,
        durationDays: plan.durationDays,
        adminPercent: split.adminPercent,
        instructorPercent: split.instructorPercent,
        adminAmount,
        instructorPoolAmount: plan.price - adminAmount,
      },
      provider: normalizedProvider,
      paymentMethod: request.paymentMethod,
      status: 'PENDING' as PaymentStatus,
    });

    try {
      const paymentUrl = normalizedProvider === 'MOMO'
        ? await this.createMomoCheckoutUrl({
            orderId: transactionCode,
            amount: plan.price,
            orderInfo,
            redirectUrl: getMomoConfig().returnUrl,
            ipnUrl: getMomoConfig().ipnUrl,
          })
        : buildVnpayPaymentUrl({
            txnRef: transactionCode,
            amount: plan.price,
            orderInfo,
            ipAddr: clientIp || '127.0.0.1',
          });

      await PaymentAttempt.create({
        transactionId: transaction._id.toString(),
        transactionCode,
        userId: user.userId,
        action: 'CHECKOUT',
        provider: normalizedProvider,
        paymentMethod: request.paymentMethod,
        success: true,
        message: 'Created subscription checkout session',
        rawPayload: { planId: plan._id.toString(), clientIp, orderInfo, paymentUrl },
      });
      return { transaction: this.mapTransaction(transaction), paymentUrl };
    } catch (error: any) {
      transaction.status = 'FAILED';
      transaction.failedAt = new Date();
      transaction.failureReason = error.message || 'Không thể tạo phiên thanh toán thuê bao.';
      await transaction.save();
      throw error;
    }
  }

  public async getTransactionForUser(transactionId: string, userId: string, userRole?: string) {
    const transaction = await this.findOwnedTransaction(transactionId, userId, userRole);
    return this.mapTransaction(transaction);
  }

  public async getTransactionByCodeForUser(transactionCode: string, userId: string, userRole?: string) {
    const transaction = await this.findOwnedTransactionByCode(transactionCode, userId, userRole);
    return this.mapTransaction(transaction);
  }

  public async getMyTransactions(
    userId: string,
    userRole: string | undefined,
    query?: { search?: string; productType?: string; status?: string; page?: number; limit?: number }
  ) {
    if (userRole === 'ADMIN') {
      throw new Error('Admin không dùng lịch sử thanh toán learner.');
    }

    const filter: Record<string, any> = { userId };
    if (query?.productType && ['COURSE', 'SUBSCRIPTION'].includes(query.productType)) {
      filter.productType = query.productType;
    }
    if (query?.status && ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'].includes(query.status)) {
      filter.status = query.status;
    } else {
      filter.status = { $in: ['SUCCEEDED', 'FAILED', 'REFUNDED'] };
    }
    const search = String(query?.search || '').trim();
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      filter.$or = [
        { transactionCode: searchRegex },
        { 'items.title': searchRegex },
        { 'subscriptionSnapshot.name': searchRegex },
      ];
    }

    const page = Math.max(Number(query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(query?.limit || 10), 1), 100);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      PaymentTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PaymentTransaction.countDocuments(filter),
    ]);

    return {
      transactions: transactions.map((transaction) => this.mapTransaction(transaction)),
      total,
      page,
      limit,
    };
  }

  private async confirmTransaction(transactionId: string, user: { userId: string; userRole: string; fullName: string; email: string }, providerRef?: string) {
    const transaction = await this.findOwnedTransaction(transactionId, user.userId);

    if (transaction.status === 'REFUNDED') {
      throw new Error('Giao dịch đã được hoàn tiền và không thể xác nhận lại.');
    }
    if (transaction.status !== 'SUCCEEDED') {
      transaction.status = 'SUCCEEDED';
      transaction.providerRef = providerRef || transaction.providerRef || randomUUID();
      transaction.paidAt = new Date();
      transaction.failureReason = '';
      await transaction.save();
    }

    await this.finalizeSuccessfulTransaction(transaction);

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

    if (transaction.productType === 'COURSE') await publishPaymentCourseFailed({
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
    // Điểm chốt trạng thái giao dịch VNPay.
    // Sau khi verify chữ ký và amount hợp lệ, hàm này đổi transaction sang SUCCEEDED rồi gọi finalizeSuccessfulTransaction.
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
    if (transaction.status === 'REFUNDED') {
      return { success: true, rspCode: '00', message: 'Giao dịch đã được hoàn tiền.', data: this.mapTransaction(transaction) };
    }
    if (transaction.status === 'SUCCEEDED') {
      await this.finalizeSuccessfulTransaction(transaction);
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

      if (transaction.productType === 'COURSE') await publishPaymentCourseFailed({
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
    await this.finalizeSuccessfulTransaction(transaction);

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
    // Điểm chốt trạng thái giao dịch MoMo.
    // Logic tương tự VNPay nhưng có thêm nhánh QUERY để reconcile khi browser return đến trước IPN.
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

    if (transaction.status === 'REFUNDED') {
      return { success: true, message: 'Giao dịch đã được hoàn tiền.', data: this.mapTransaction(transaction) };
    }
    if (transaction.status === 'SUCCEEDED') {
      await this.finalizeSuccessfulTransaction(transaction);
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

    if (this.momoPendingResultCodes.has(resultCode)) {
      transaction.failureReason = String(payload.message || 'Giao dịch MoMo đang được xử lý.');
      transaction.providerRef = transId || transaction.providerRef;
      await transaction.save();
      return {
        success: true,
        pending: true,
        message: transaction.failureReason,
        data: this.mapTransaction(transaction),
      };
    }

    if (![0, 9000].includes(resultCode)) {
      transaction.status = 'FAILED';
      transaction.failedAt = new Date();
      transaction.failureReason = String(payload.message || `Thanh toán MoMo thất bại (Mã phản hồi: ${resultCode}).`);
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

      if (transaction.productType === 'COURSE') await publishPaymentCourseFailed({
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

    if (Math.round(transaction.amount) !== Math.round(amount)) {
      return { success: false, message: 'Số tiền thanh toán không khớp với giao dịch.' };
    }

    transaction.status = 'SUCCEEDED';
    transaction.providerRef = transId || transaction.providerRef || randomUUID();
    transaction.paidAt = responseTime ? new Date(Number(responseTime)) : new Date();
    transaction.failureReason = '';
    await transaction.save();
    await this.finalizeSuccessfulTransaction(transaction);

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

  public async reconcilePendingMomoTransactions() {
    const transactions = await PaymentTransaction.find({
      provider: 'MOMO',
      status: 'PENDING',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .select('transactionCode')
      .lean();

    for (const transaction of transactions) {
      try {
        await this.reconcileMomoTransaction(transaction.transactionCode);
      } catch (error: any) {
        console.warn(
          `[MomoReconcile] Không thể đối soát ${transaction.transactionCode}:`,
          error.message
        );
      }
    }
  }

  private async fetchCart(token: string): Promise<{ items: PaymentCourseItem[]; totalPrice: number }> {
    // payment-service không tự giữ cart.
    // Trước khi tạo checkout, service gọi ngược sang course-service để chụp lại snapshot giỏ hàng hiện tại.
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

  private async findOwnedTransaction(transactionId: string, userId: string, userRole?: string): Promise<IPaymentTransaction> {
    const transaction = await PaymentTransaction.findById(transactionId);
    if (!transaction) {
      throw new Error('Giao dịch không tồn tại.');
    }
    if (userRole !== 'ADMIN' && transaction.userId !== userId) {
      throw new Error('Bạn không có quyền truy cập giao dịch này.');
    }
    return transaction;
  }

  private async findOwnedTransactionByCode(transactionCode: string, userId: string, userRole?: string): Promise<IPaymentTransaction> {
    const transaction = await PaymentTransaction.findOne({ transactionCode });
    if (!transaction) {
      throw new Error('Giao dịch không tồn tại.');
    }
    if (userRole !== 'ADMIN' && transaction.userId !== userId) {
      throw new Error('Bạn không có quyền truy cập giao dịch này.');
    }
    return transaction;
  }

  private mapTransaction(transaction: any) {
    const splitTotals = transaction.productType === 'SUBSCRIPTION' && transaction.subscriptionSnapshot
      ? {
          adminAmount: transaction.subscriptionSnapshot.adminAmount,
          instructorAmount: transaction.subscriptionSnapshot.instructorPoolAmount,
        }
      : this.calculateTransactionSplitTotals(transaction);
    return {
      _id: transaction._id.toString(),
      transactionCode: transaction.transactionCode,
      userId: transaction.userId,
      userRole: transaction.userRole,
      fullName: transaction.fullName,
      email: transaction.email,
      items: transaction.items,
      amount: transaction.amount,
      productType: transaction.productType || 'COURSE',
      subscriptionSnapshot: transaction.subscriptionSnapshot || null,
      grossAmount: transaction.amount,
      adminAmount: splitTotals.adminAmount,
      instructorAmount: splitTotals.instructorAmount,
      provider: transaction.provider,
      paymentMethod: transaction.paymentMethod,
      status: transaction.status,
      refundedAt: transaction.refundedAt || null,
      refundedBy: transaction.refundedBy || '',
      refundReason: transaction.refundReason || '',
      providerRef: transaction.providerRef || '',
      failureReason: transaction.failureReason || '',
      paidAt: transaction.paidAt || null,
      failedAt: transaction.failedAt || null,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  private toPaymentItem(item: { _id: string; slug: string; title: string; price: number; thumbnail?: string; instructorName?: string; instructorId?: string }): PaymentCourseItem {
    return {
      courseId: item._id,
      slug: item.slug,
      title: item.title,
      price: item.price,
      thumbnail: item.thumbnail,
      instructorName: item.instructorName,
      instructorId: item.instructorId,
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

  private async ensureRevenueSnapshot(transaction: IPaymentTransaction): Promise<void> {
    const config = await this.ensureFinanceSplitConfig();
    let changed = false;

    transaction.items = transaction.items.map((item) => {
      const hasValidSnapshot =
        Number.isFinite(item.adminPercent) &&
        Number.isFinite(item.instructorPercent) &&
        item.adminPercent! + item.instructorPercent! === 100;
      const adminPercent = hasValidSnapshot ? item.adminPercent! : config.adminPercent;
      const instructorPercent = hasValidSnapshot ? item.instructorPercent! : config.instructorPercent;
      const adminAmount = this.calculateSplitAmount(item.price, adminPercent);
      const instructorAmount = item.price - adminAmount;

      if (
        item.instructorId !== (item.instructorId || '') ||
        item.adminPercent !== adminPercent ||
        item.instructorPercent !== instructorPercent ||
        item.adminAmount !== adminAmount ||
        item.instructorAmount !== instructorAmount
      ) {
        changed = true;
      }

      return {
        ...item,
        instructorId: item.instructorId || '',
        adminPercent,
        instructorPercent,
        adminAmount,
        instructorAmount,
      };
    });

    if (changed) {
      await transaction.save();
    }
  }

  // Phân nhánh logic sau khi giao dịch được xác nhận thành công. Mục đích là tách biệt rõ ràng giữa việc ghi nhận giao dịch thành công và các bước xử lý nghiệp vụ tiếp theo như mở khóa khóa học hoặc kích hoạt thuê bao.
  private async finalizeSuccessfulTransaction(transaction: IPaymentTransaction): Promise<void> {
    // Phân nhánh sau thanh toán thành công.
    // Mua đứt sẽ phát event để course-service mở enrollment; subscription sẽ tạo term active thay vì enroll course.
    if (transaction.productType === 'SUBSCRIPTION') {
      // Subscription không phát event enroll course; nó tạo term để downstream tự mở quyền theo entitlement.
      await subscriptionService.activatePaidTransaction(transaction);
      return;
    }
    await this.ensureRevenueSnapshot(transaction);
    await publishPaymentCourseSucceeded(this.toSucceededPayload(transaction));
  }

  private async ensureFinanceSplitConfig(): Promise<RevenueSplitConfig> {
    const adminPercent = Number(process.env.DEFAULT_ADMIN_REVENUE_PERCENT || 25);
    const instructorPercent = Number(process.env.DEFAULT_INSTRUCTOR_REVENUE_PERCENT || 75);
    const normalizedAdmin = Number.isFinite(adminPercent) ? adminPercent : 25;
    const normalizedInstructor = Number.isFinite(instructorPercent) ? instructorPercent : 75;

    const config = await FinanceConfig.findOneAndUpdate(
      { configKey: this.financeConfigKey },
      { $setOnInsert: { adminPercent: normalizedAdmin, instructorPercent: normalizedInstructor } },
      { upsert: true, new: true, lean: true }
    );

    return {
      adminPercent: config!.adminPercent,
      instructorPercent: config!.instructorPercent,
    };
  }

  private calculateSplitAmount(amount: number, percent: number): number {
    return Math.floor((amount * percent) / 100);
  }

  private calculateTransactionSplitTotals(transaction: any) {
    if (transaction.productType === 'SUBSCRIPTION' && transaction.subscriptionSnapshot) {
      // Subscription lấy split từ snapshot cấp transaction thay vì từ danh sách course items.
      return {
        adminAmount: transaction.subscriptionSnapshot.adminAmount || 0,
        instructorAmount: transaction.subscriptionSnapshot.instructorPoolAmount || 0,
      };
    }
    return transaction.items.reduce(
      (acc: { adminAmount: number; instructorAmount: number }, item: any) => {
        const adminAmount = item.adminAmount ?? this.calculateSplitAmount(item.price, item.adminPercent ?? 0);
        const instructorAmount = item.instructorAmount ?? (item.price - adminAmount);
        acc.adminAmount += adminAmount;
        acc.instructorAmount += instructorAmount;
        return acc;
      },
      { adminAmount: 0, instructorAmount: 0 }
    );
  }

  private async queryTransactions(query?: { search?: string; startDate?: string; endDate?: string; provider?: string; status?: string; page?: number; limit?: number }) {
    const filter: Record<string, any> = {};
    if (query?.provider) filter.provider = query.provider;
    if (query?.status) {
      filter.status = query.status;
    }
    const search = String(query?.search || '').trim();
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      filter.$or = [
        { transactionCode: searchRegex },
        { fullName: searchRegex },
        { email: searchRegex },
        { 'items.title': searchRegex },
        { 'subscriptionSnapshot.name': searchRegex },
      ];
    }
    if (query?.startDate || query?.endDate) {
      filter.createdAt = {};
      if (query.startDate) filter.createdAt.$gte = new Date(query.startDate);
      if (query.endDate) filter.createdAt.$lte = new Date(query.endDate);
    }

    const page = Math.max(Number(query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(query?.limit || 10), 1), 100);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      PaymentTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PaymentTransaction.countDocuments(filter),
    ]);

    return { transactions, total, page, limit };
  }

  private async buildRevenueSummary(transactions: any[]) {
    const summary = transactions.reduce(
      (acc: any, transaction: any) => {
        if (transaction.status !== 'SUCCEEDED') {
          return acc;
        }
        const paidAt = transaction.paidAt || transaction.createdAt;
        const month = `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, '0')}`;
        const splitTotals = this.calculateTransactionSplitTotals(transaction);

        acc.totalRevenue += transaction.amount;
        acc.totalAdminRevenue += splitTotals.adminAmount;
        acc.totalInstructorRevenue += splitTotals.instructorAmount;
        acc.successfulTransactions += 1;

        const monthBucket = acc.monthlyData.find((entry: any) => entry.month === month);
        if (monthBucket) {
          monthBucket.revenue += transaction.amount;
          monthBucket.adminRevenue += splitTotals.adminAmount;
          monthBucket.instructorRevenue += splitTotals.instructorAmount;
          monthBucket.transactions += 1;
        } else {
          acc.monthlyData.push({
            month,
            revenue: transaction.amount,
            adminRevenue: splitTotals.adminAmount,
            instructorRevenue: splitTotals.instructorAmount,
            transactions: 1,
          });
        }

        const providerBucket = acc.providerBreakdown.find((entry: any) => entry.provider === transaction.provider);
        if (providerBucket) {
          providerBucket.revenue += transaction.amount;
          providerBucket.adminRevenue += splitTotals.adminAmount;
          providerBucket.instructorRevenue += splitTotals.instructorAmount;
          providerBucket.transactions += 1;
        } else {
          acc.providerBreakdown.push({
            provider: transaction.provider,
            revenue: transaction.amount,
            adminRevenue: splitTotals.adminAmount,
            instructorRevenue: splitTotals.instructorAmount,
            transactions: 1,
          });
        }

        return acc;
      },
      {
        totalRevenue: 0,
        totalAdminRevenue: 0,
        totalInstructorRevenue: 0,
        successfulTransactions: 0,
        monthlyData: [] as Array<{ month: string; revenue: number; adminRevenue: number; instructorRevenue: number; transactions: number }>,
        providerBreakdown: [] as Array<{ provider: PaymentProvider; revenue: number; adminRevenue: number; instructorRevenue: number; transactions: number }>,
      }
    );

    summary.monthlyData.sort((a: any, b: any) => a.month.localeCompare(b.month));

    const splitConfig = await this.ensureFinanceSplitConfig();
    const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const currentMonthData = summary.monthlyData.find((entry: any) => entry.month === currentMonth);

    return {
      ...summary,
      adminPercent: splitConfig.adminPercent,
      instructorPercent: splitConfig.instructorPercent,
      thisMonthRevenue: currentMonthData?.revenue ?? 0,
      thisMonthAdminRevenue: currentMonthData?.adminRevenue ?? 0,
      thisMonthInstructorRevenue: currentMonthData?.instructorRevenue ?? 0,
      activeSubscriptions: 0,
    };
  }

  private buildInstructorSummary(items: Array<{
    transactionCode: string;
    transactionId: string;
    provider: PaymentProvider;
    paymentMethod: PaymentMethod;
    paidAt: Date;
    courseId: string;
    courseTitle: string;
    slug: string;
    instructorId: string;
    instructorName: string;
    grossAmount: number;
    adminPercent: number;
    instructorPercent: number;
    adminAmount: number;
    instructorAmount: number;
  }>) {
    const summary = items.reduce(
      (acc: any, item: any) => {
        const month = `${item.paidAt.getFullYear()}-${String(item.paidAt.getMonth() + 1).padStart(2, '0')}`;
        acc.totalGrossRevenue += item.grossAmount;
        acc.totalAdminRevenue += item.adminAmount;
        acc.totalInstructorRevenue += item.instructorAmount;
        acc.totalTransactions += 1;

        const monthBucket = acc.monthlyData.find((entry: any) => entry.month === month);
        if (monthBucket) {
          monthBucket.revenue += item.grossAmount;
          monthBucket.adminRevenue += item.adminAmount;
          monthBucket.instructorRevenue += item.instructorAmount;
          monthBucket.transactions += 1;
        } else {
          acc.monthlyData.push({
            month,
            revenue: item.grossAmount,
            adminRevenue: item.adminAmount,
            instructorRevenue: item.instructorAmount,
            transactions: 1,
          });
        }

        const courseBucket = acc.courseBreakdown.find((entry: any) => entry.courseId === item.courseId);
        if (courseBucket) {
          courseBucket.grossRevenue += item.grossAmount;
          courseBucket.adminRevenue += item.adminAmount;
          courseBucket.instructorRevenue += item.instructorAmount;
          courseBucket.transactions += 1;
        } else {
          acc.courseBreakdown.push({
            courseId: item.courseId,
            courseTitle: item.courseTitle,
            slug: item.slug,
            grossRevenue: item.grossAmount,
            adminRevenue: item.adminAmount,
            instructorRevenue: item.instructorAmount,
            transactions: 1,
          });
        }

        const providerBucket = acc.providerBreakdown.find((entry: any) => entry.provider === item.provider);
        if (providerBucket) {
          providerBucket.revenue += item.grossAmount;
          providerBucket.adminRevenue += item.adminAmount;
          providerBucket.instructorRevenue += item.instructorAmount;
          providerBucket.transactions += 1;
        } else {
          acc.providerBreakdown.push({
            provider: item.provider,
            revenue: item.grossAmount,
            adminRevenue: item.adminAmount,
            instructorRevenue: item.instructorAmount,
            transactions: 1,
          });
        }

        return acc;
      },
      {
        totalGrossRevenue: 0,
        totalAdminRevenue: 0,
        totalInstructorRevenue: 0,
        totalTransactions: 0,
        monthlyData: [] as Array<{ month: string; revenue: number; adminRevenue: number; instructorRevenue: number; transactions: number }>,
        providerBreakdown: [] as Array<{ provider: PaymentProvider; revenue: number; adminRevenue: number; instructorRevenue: number; transactions: number }>,
        courseBreakdown: [] as Array<{ courseId: string; courseTitle: string; slug: string; grossRevenue: number; adminRevenue: number; instructorRevenue: number; transactions: number }>,
      }
    );

    summary.monthlyData.sort((a: any, b: any) => a.month.localeCompare(b.month));
    summary.courseBreakdown.sort((a: any, b: any) => b.instructorRevenue - a.instructorRevenue);

    return summary;
  }

  public async getFinanceSplitConfig(): Promise<RevenueSplitConfig> {
    return this.ensureFinanceSplitConfig();
  }

  public async updateFinanceSplitConfig(input: RevenueSplitConfig): Promise<RevenueSplitConfig> {
    const adminPercent = Number(input.adminPercent);
    const instructorPercent = Number(input.instructorPercent);

    if (!Number.isInteger(adminPercent) || !Number.isInteger(instructorPercent)) {
      throw new Error('Tỷ lệ chia doanh thu phải là số nguyên.');
    }
    if (adminPercent < 0 || instructorPercent < 0 || adminPercent > 100 || instructorPercent > 100) {
      throw new Error('Tỷ lệ chia doanh thu phải nằm trong khoảng 0-100%.');
    }
    if (adminPercent + instructorPercent !== 100) {
      throw new Error('Tổng tỷ lệ chia doanh thu phải bằng 100%.');
    }

    const config = await FinanceConfig.findOneAndUpdate(
      { configKey: this.financeConfigKey },
      {
        $set: {
          adminPercent,
          instructorPercent,
        },
        $setOnInsert: {
          configKey: this.financeConfigKey,
        },
      },
      { new: true, upsert: true }
    );

    return {
      adminPercent: config.adminPercent,
      instructorPercent: config.instructorPercent,
    };
  }

  public async getAdminFinanceOverview(query?: { search?: string; startDate?: string; endDate?: string; provider?: string; status?: string; page?: number; limit?: number }) {
    const { transactions, total } = await this.queryTransactions(query);
    await Promise.all(
      transactions
        .filter((transaction) => transaction.status === 'SUCCEEDED')
        .map((transaction) => this.ensureRevenueSnapshot(transaction))
    );
    const summary = await this.buildRevenueSummary(transactions);
    const succeededTransactions = transactions.filter((transaction) => transaction.status === 'SUCCEEDED');
    const totalAmount = succeededTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const splitTotals = transactions.reduce(
      (acc, transaction) => {
        if (transaction.status !== 'SUCCEEDED') {
          return acc;
        }
        const split = this.calculateTransactionSplitTotals(transaction);
        acc.adminAmount += split.adminAmount;
        acc.instructorAmount += split.instructorAmount;
        return acc;
      },
      { adminAmount: 0, instructorAmount: 0 }
    );

    return {
      ...summary,
      transactions: transactions.map((transaction) => this.mapTransaction(transaction)),
      total,
      totalAmount,
      totalAdminAmount: splitTotals.adminAmount,
      totalInstructorAmount: splitTotals.instructorAmount,
      page: Number(query?.page || 1),
      limit: Number(query?.limit || 20),
    };
  }

  public async getInstructorFinanceOverview(instructorId: string, query?: { startDate?: string; endDate?: string }) {
    const filter: Record<string, any> = { status: 'SUCCEEDED' };
    if (query?.startDate || query?.endDate) {
      filter.paidAt = {};
      if (query.startDate) filter.paidAt.$gte = new Date(query.startDate);
      if (query.endDate) filter.paidAt.$lte = new Date(query.endDate);
    }

    const transactions = await PaymentTransaction.find(filter).sort({ paidAt: -1, createdAt: -1 });
    await Promise.all(transactions.map((transaction) => this.ensureRevenueSnapshot(transaction)));
    const items = transactions.flatMap((transaction) => {
      const paidAt = transaction.paidAt || transaction.createdAt;
      return transaction.items
        .filter((item) => item.instructorId === instructorId)
        .map((item) => ({
          transactionCode: transaction.transactionCode,
          transactionId: transaction._id.toString(),
          provider: transaction.provider,
          paymentMethod: transaction.paymentMethod,
          paidAt,
          courseId: item.courseId,
          courseTitle: item.title,
          slug: item.slug,
          instructorId: item.instructorId || instructorId,
          instructorName: item.instructorName || '',
          grossAmount: item.price,
          adminPercent: item.adminPercent ?? 0,
          instructorPercent: item.instructorPercent ?? 0,
          adminAmount: item.adminAmount ?? 0,
          instructorAmount: item.instructorAmount ?? 0,
        }));
    });

    const summary = this.buildInstructorSummary(items);
    const splitConfig = await this.ensureFinanceSplitConfig();
    return {
      ...summary,
      adminPercent: splitConfig.adminPercent,
      instructorPercent: splitConfig.instructorPercent,
    };
  }

  // Hàm này tạo mã giao dịch duy nhất dựa trên provider và timestamp. Nó giúp đảm bảo không bị trùng lặp mã giao dịch khi có nhiều cổng thanh toán hoặc phương thức thanh toán khác nhau.
  private generateTransactionCode(provider: PaymentProvider): string {
    const prefix = provider === 'MOMO' ? 'MM' : provider === 'VNPAY' ? 'VNP' : 'PM';
    return `${prefix}${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`;
  }

  private normalizeProvider(provider: PaymentProvider | undefined, paymentMethod: PaymentMethod): PaymentProvider {
    if (provider) return provider;
    return paymentMethod === 'MOMO' ? 'MOMO' : 'VNPAY';
  }

  // Hàm này xây dựng thông tin đơn hàng để gửi cho cổng thanh toán. Nó bao gồm mã giao dịch và số lượng khóa học để giúp người dùng dễ nhận biết giao dịch của họ khi xem lịch sử giao dịch trên cổng thanh toán.
  private buildOrderInfo(transactionCode: string, itemCount: number): string {
    return `SecureLearn payment ${transactionCode}${itemCount > 1 ? ` (${itemCount} courses)` : ''}`;
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
  }) {
    const session = await createMomoPaymentSession({
      requestId: `${input.orderId}${Date.now()}`,
      orderId: input.orderId,
      amount: input.amount,
      orderInfo: input.orderInfo,
      redirectUrl: input.redirectUrl,
      ipnUrl: input.ipnUrl,
    });

    if (!session.payUrl) {
      throw new Error('MoMo không trả về đường dẫn thanh toán.');
    }

    return session.payUrl;
  }

}

export default new PaymentService();
