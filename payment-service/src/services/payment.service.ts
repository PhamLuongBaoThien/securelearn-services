// Payment Service Layer
// Mục đích:
// - tạo checkout cho giỏ hàng khóa học
// - tra cứu transaction
// - confirm/fail giao dịch
// - xử lý webhook theo provider
// Hàm chính:
// - createCourseCheckout()
// - getTransactionForUser()
// - confirmTransaction()
// - failTransaction()
// - handleWebhook()

import { randomUUID } from 'crypto'; // dùng để tạo transactionCode ngẫu nhiên khi chưa có
import { PaymentMethod, PaymentProvider, PaymentStatus, type PaymentCourseSucceededPayload } from '@securelearn/common';
import { PaymentAttempt } from '../models/paymentAttempt.model';
import { PaymentTransaction, type PaymentCourseItem, type IPaymentTransaction } from '../models/paymentTransaction.model';
import { PaymentWebhookEvent } from '../models/paymentWebhookEvent.model';
import { publishPaymentCourseFailed, publishPaymentCourseSucceeded } from '../events/publishers';

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

  public async createCourseCheckout(user: { userId: string; userRole: string; fullName: string; email: string }, token: string, request: CheckoutRequest) {
    const cart = await this.fetchCart(token);
    if (cart.items.length === 0) {
      throw new Error('Giỏ hàng của bạn đang trống.');
    }

    const normalizedProvider = this.normalizeProvider(request.provider, request.paymentMethod); // dùng trong trường hợp provider không được truyền
    const transactionCode = this.generateTransactionCode(normalizedProvider);

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
      rawPayload: { cartCount: cart.items.length },
    });

    return {
      transaction: this.mapTransaction(transaction),
      paymentUrl: `${this.clientUrl}/payment/process/${transaction._id.toString()}?provider=${normalizedProvider}`,
    };
  }

  public async getTransactionForUser(transactionId: string, userId: string) {
    const transaction = await this.findOwnedTransaction(transactionId, userId);
    return this.mapTransaction(transaction);
  }

  public async confirmTransaction(transactionId: string, user: { userId: string; userRole: string; fullName: string; email: string }, providerRef?: string) {
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

  public async handleWebhook(provider: PaymentProvider, body: Record<string, unknown>) {
    const eventId = String(body.eventId || body.transactionCode || randomUUID());
    const transactionCode = String(body.transactionCode || body.orderId || '');
    const status = String(body.status || 'SUCCEEDED').toUpperCase();
    if (!transactionCode) {
      throw new Error('Thiếu mã giao dịch.');
    }

    const existingWebhook = await PaymentWebhookEvent.findOne({ provider, eventId });
    if (existingWebhook) {
      const transaction = await PaymentTransaction.findOne({ transactionCode });
      if (!transaction) throw new Error('Giao dịch không tồn tại.');
      return this.mapTransaction(transaction);
    }

    const transaction = await PaymentTransaction.findOne({ transactionCode });
    if (!transaction) {
      throw new Error('Giao dịch không tồn tại.');
    }

    if (status === 'FAILED') {
      await this.failTransaction(transaction._id.toString(), transaction.userId, String(body.reason || 'Thanh toán thất bại.'));
    } else {
      if (transaction.status !== 'SUCCEEDED') {
        transaction.status = 'SUCCEEDED';
        transaction.providerRef = String(body.providerRef || transaction.providerRef || randomUUID());
        transaction.paidAt = new Date();
        transaction.failureReason = '';
        await transaction.save();

        await publishPaymentCourseSucceeded(this.toSucceededPayload(transaction));
      }
    }

    await PaymentWebhookEvent.create({
      provider,
      eventId,
      transactionCode,
      status,
      processedAt: new Date(),
      rawPayload: body,
    });

    return this.mapTransaction(transaction);
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
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  }

  private normalizeProvider(provider: PaymentProvider | undefined, paymentMethod: PaymentMethod): PaymentProvider {
    if (provider) return provider;
    return paymentMethod === 'MOMO' ? 'MOMO' : 'VNPAY';
  }
}

export default new PaymentService();
