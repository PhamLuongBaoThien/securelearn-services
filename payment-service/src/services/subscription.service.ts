// ========================
// Subscription Service
// Mục đích:
// - quản lý lifecycle của plan, term, usage, settlement và refund thuê bao
// - tạo snapshot kế toán để dữ liệu doanh thu lịch sử không bị lệch khi config đổi sau này
// ========================
import { PaymentTransaction, type IPaymentTransaction } from '../models/paymentTransaction.model';
import { SubscriptionAudit } from '../models/subscriptionAudit.model';
import { SubscriptionPlan, type SubscriptionPlanType } from '../models/subscriptionPlan.model';
import { SubscriptionSettlement, type SubscriptionSettlementStatus } from '../models/subscriptionSettlement.model';
import { SubscriptionUsage } from '../models/subscriptionUsage.model';
import { UserSubscriptionTerm, type IUserSubscriptionTerm } from '../models/userSubscriptionTerm.model';
import { publishSubscriptionTermChanged } from '../events/publishers';

type PlanInput = {
  type: SubscriptionPlanType;
  name: string;
  description?: string;
  price: number;
  features?: string[];
  sortOrder?: number;
  isActive?: boolean;
};

type UsageInput = {
  termId: string;
  userId: string;
  courseId: string;
  instructorId: string;
  lessonId: string;
  sessionId: string;
  segmentIndex: number;
  qualifiedSeconds: number;
  occurredAt?: string;
};

class SubscriptionService {
  public async ensureDefaultPlans() {
    await Promise.all([
      SubscriptionPlan.findOneAndUpdate(
        { type: 'MONTHLY' },
        {
          $setOnInsert: {
            name: 'SecureLearn Monthly',
            description: 'Truy cập catalog thuê bao trong 30 ngày.',
            price: 199000,
            durationDays: 30,
            features: ['Học các khóa trong catalog thuê bao', 'Giữ tiến độ khi gia hạn'],
            sortOrder: 10,
            isActive: true,
          },
        },
        { upsert: true }
      ),
      SubscriptionPlan.findOneAndUpdate(
        { type: 'YEARLY' },
        {
          $setOnInsert: {
            name: 'SecureLearn Yearly',
            description: 'Truy cập catalog thuê bao trong 365 ngày.',
            price: 1499000,
            durationDays: 365,
            features: ['Học các khóa trong catalog thuê bao', 'Giữ tiến độ khi gia hạn'],
            sortOrder: 20,
            isActive: true,
          },
        },
        { upsert: true }
      ),
    ]);
  }

  public async getPublicPlans() {
    await this.ensureDefaultPlans();
    return SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }).lean();
  }

  public async getAdminPlans() {
    await this.ensureDefaultPlans();
    return SubscriptionPlan.find().sort({ sortOrder: 1, price: 1 }).lean();
  }

  public async upsertPlan(input: PlanInput, actorId: string) {
    const durationDays = input.type === 'MONTHLY' ? 30 : 365;
    if (!input.name?.trim()) throw new Error('Tên gói thuê bao không được để trống.');
    if (!Number.isFinite(Number(input.price)) || Number(input.price) < 1000) {
      throw new Error('Giá gói thuê bao phải từ 1.000đ.');
    }

    const plan = await SubscriptionPlan.findOneAndUpdate(
      { type: input.type },
      {
        $set: {
          name: input.name.trim(),
          description: String(input.description || '').trim(),
          price: Math.round(Number(input.price)),
          durationDays,
          features: (input.features || []).map((item) => String(item).trim()).filter(Boolean),
          sortOrder: Number(input.sortOrder || 0),
          isActive: input.isActive !== false,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    await this.audit(actorId, 'ADMIN', 'SUBSCRIPTION_PLAN_UPSERTED', 'SubscriptionPlan', plan._id.toString(), {
      type: plan.type,
      price: plan.price,
      isActive: plan.isActive,
    });
    return plan;
  }

  public async activatePaidTransaction(transaction: IPaymentTransaction) {
    if (transaction.productType !== 'SUBSCRIPTION' || !transaction.subscriptionSnapshot) {
      throw new Error('Giao dịch không chứa snapshot gói thuê bao.');
    }

    const existing = await UserSubscriptionTerm.findOne({ transactionId: transaction._id.toString() });
    if (existing) {
      return existing;
    }

    // Khi user còn hạn, kỳ mới phải nối tiếp cuối kỳ cũ thay vì chồng thời gian.
    const now = transaction.paidAt || new Date();
    const latest = await UserSubscriptionTerm.findOne({
      userId: transaction.userId,
      status: { $in: ['ACTIVE', 'SCHEDULED'] },
      endsAt: { $gt: now },
    }).sort({ endsAt: -1 });
    const startsAt = latest?.endsAt && latest.endsAt > now ? latest.endsAt : now;
    const endsAt = this.addDays(startsAt, transaction.subscriptionSnapshot.durationDays);
    const status = startsAt > new Date() ? 'SCHEDULED' : 'ACTIVE';

    let term: IUserSubscriptionTerm;
    try {
      term = await UserSubscriptionTerm.create({
        userId: transaction.userId,
        transactionId: transaction._id.toString(),
        transactionCode: transaction.transactionCode,
        planId: transaction.subscriptionSnapshot.planId,
        planType: transaction.subscriptionSnapshot.planType,
        planName: transaction.subscriptionSnapshot.name,
        price: transaction.amount,
        durationDays: transaction.subscriptionSnapshot.durationDays,
        adminPercent: transaction.subscriptionSnapshot.adminPercent,
        instructorPercent: transaction.subscriptionSnapshot.instructorPercent,
        adminAmount: transaction.subscriptionSnapshot.adminAmount,
        instructorPoolAmount: transaction.subscriptionSnapshot.instructorPoolAmount,
        status,
        startsAt,
        endsAt,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicate = await UserSubscriptionTerm.findOne({ transactionId: transaction._id.toString() });
        if (duplicate) return duplicate;
      }
      throw error;
    }

    await this.audit(transaction.userId, transaction.userRole, 'SUBSCRIPTION_TERM_CREATED', 'UserSubscriptionTerm', term._id.toString(), {
      transactionCode: transaction.transactionCode,
      status,
    });
    await this.publishTerm(term);
    return term;
  }

  public async getUserSubscription(userId: string) {
    await this.refreshTermStatuses();
    const terms = await UserSubscriptionTerm.find({ userId }).sort({ startsAt: -1 }).lean();
    return {
      current: terms.find((term) => term.status === 'ACTIVE') || null,
      scheduled: terms.filter((term) => term.status === 'SCHEDULED').sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      history: terms,
    };
  }

  public async refreshTermStatuses(now = new Date()) {
    const expiring = await UserSubscriptionTerm.find({ status: 'ACTIVE', endsAt: { $lte: now } });
    for (const term of expiring) {
      term.status = 'EXPIRED';
      await term.save();
      await this.publishTerm(term);
    }

    const activatable = await UserSubscriptionTerm.find({ status: 'SCHEDULED', startsAt: { $lte: now }, endsAt: { $gt: now } }).sort({ startsAt: 1 });
    for (const term of activatable) {
      const anotherActive = await UserSubscriptionTerm.exists({
        _id: { $ne: term._id },
        userId: term.userId,
        status: 'ACTIVE',
        endsAt: { $gt: now },
      });
      if (!anotherActive) {
        term.status = 'ACTIVE';
        await term.save();
        await this.publishTerm(term);
      }
    }
  }

  public async recordUsage(input: UsageInput) {
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const seconds = Math.min(15, Math.max(1, Math.floor(Number(input.qualifiedSeconds))));
    const term = await UserSubscriptionTerm.findOne({
      _id: input.termId,
      userId: input.userId,
      status: 'ACTIVE',
      startsAt: { $lte: occurredAt },
      endsAt: { $gt: occurredAt },
    });
    if (!term) throw new Error('Kỳ thuê bao không còn hiệu lực.');

    try {
      return await SubscriptionUsage.create({
        ...input,
        segmentIndex: Math.max(0, Math.floor(Number(input.segmentIndex))),
        qualifiedSeconds: seconds,
        occurredAt,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        return SubscriptionUsage.findOne({
          termId: input.termId,
          userId: input.userId,
          lessonId: input.lessonId,
          segmentIndex: input.segmentIndex,
        });
      }
      throw error;
    }
  }

  public async calculateSettlement(period: string, actorId: string) {
    const existingSettlement = await SubscriptionSettlement.findOne({ period });
    if (existingSettlement && ['LOCKED', 'AVAILABLE'].includes(existingSettlement.status)) {
      throw new Error('Settlement đã khóa hoặc available, không thể tính lại.');
    }
    // Revenue của gói năm/tháng được ghi nhận dần theo phần thời gian overlap với tháng đang tính.
    const { start, end } = this.periodBounds(period);
    const terms = await UserSubscriptionTerm.find({
      status: { $ne: 'REFUNDED' },
      startsAt: { $lt: end },
      endsAt: { $gt: start },
    }).lean();

    let recognizedGross = 0;
    let adminRevenue = 0;
    let instructorPool = 0;
    for (const term of terms) {
      const overlapMs = Math.max(0, Math.min(term.endsAt.getTime(), end.getTime()) - Math.max(term.startsAt.getTime(), start.getTime()));
      const ratio = overlapMs / (term.durationDays * 86400000);
      recognizedGross += Math.round(term.price * ratio);
      adminRevenue += Math.round(term.adminAmount * ratio);
      instructorPool += Math.round(term.instructorPoolAmount * ratio);
    }

    const previous = await SubscriptionSettlement.findOne({ period: { $lt: period } }).sort({ period: -1 }).lean();
    const carriedIn = previous?.carriedOut || 0;
    // Pool của instructor chỉ được chia theo qualified usage đã qua heartbeat validation.
    const usage = await SubscriptionUsage.aggregate<{
      _id: { instructorId: string; courseId: string };
      qualifiedSeconds: number;
    }>([
      { $match: { occurredAt: { $gte: start, $lt: end } } },
      { $group: { _id: { instructorId: '$instructorId', courseId: '$courseId' }, qualifiedSeconds: { $sum: '$qualifiedSeconds' } } },
      { $sort: { qualifiedSeconds: -1 } },
    ]);
    const totalQualifiedSeconds = usage.reduce((sum, item) => sum + item.qualifiedSeconds, 0);
    const distributable = instructorPool + carriedIn;
    let allocated = 0;
    const allocations = usage.map((item, index) => {
      const amount = totalQualifiedSeconds === 0
        ? 0
        : index === usage.length - 1
          ? distributable - allocated
          : Math.floor((distributable * item.qualifiedSeconds) / totalQualifiedSeconds);
      allocated += amount;
      return {
        instructorId: item._id.instructorId,
        courseId: item._id.courseId,
        qualifiedSeconds: item.qualifiedSeconds,
        amount,
      };
    });

    const settlement = await SubscriptionSettlement.findOneAndUpdate(
      { period },
      {
        $set: {
          status: 'CALCULATED',
          recognizedGross,
          adminRevenue,
          instructorPool,
          carriedIn,
          carriedOut: totalQualifiedSeconds === 0 ? distributable : 0,
          totalQualifiedSeconds,
          allocations,
          calculatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    await this.audit(actorId, 'ADMIN', 'SUBSCRIPTION_SETTLEMENT_CALCULATED', 'SubscriptionSettlement', settlement._id.toString(), { period });
    return settlement;
  }

  public async updateSettlementStatus(period: string, status: SubscriptionSettlementStatus, actorId: string) {
    const settlement = await SubscriptionSettlement.findOne({ period });
    if (!settlement) throw new Error('Kỳ settlement không tồn tại.');
    const allowed: Record<SubscriptionSettlementStatus, SubscriptionSettlementStatus[]> = {
      OPEN: ['CALCULATED'],
      CALCULATED: ['LOCKED'],
      LOCKED: ['AVAILABLE'],
      AVAILABLE: [],
    };
    if (!allowed[settlement.status].includes(status)) throw new Error('Chuyển trạng thái settlement không hợp lệ.');
    if (status === 'LOCKED' && settlement.calculatedAt && Date.now() < settlement.calculatedAt.getTime() + 7 * 86400000) {
      throw new Error('Settlement chỉ được khóa sau 7 ngày kể từ lúc tính.');
    }
    settlement.status = status;
    if (status === 'LOCKED') settlement.lockedAt = new Date();
    if (status === 'AVAILABLE') settlement.availableAt = new Date();
    await settlement.save();
    await this.audit(actorId, 'ADMIN', 'SUBSCRIPTION_SETTLEMENT_STATUS_CHANGED', 'SubscriptionSettlement', settlement._id.toString(), { period, status });
    return settlement;
  }

  public async getSettlements() {
    return SubscriptionSettlement.find().sort({ period: -1 }).lean();
  }

  public async getInstructorFinance(instructorId: string) {
    const settlements = await SubscriptionSettlement.find({ 'allocations.instructorId': instructorId }).sort({ period: -1 }).lean();
    const rows = settlements.flatMap((settlement) =>
      settlement.allocations
        .filter((item) => item.instructorId === instructorId)
        .map((item) => ({ ...item, period: settlement.period, status: settlement.status }))
    );
    return {
      estimated: rows.filter((row) => ['OPEN', 'CALCULATED'].includes(row.status)).reduce((sum, row) => sum + row.amount, 0),
      pending: rows.filter((row) => row.status === 'LOCKED').reduce((sum, row) => sum + row.amount, 0),
      available: rows.filter((row) => row.status === 'AVAILABLE').reduce((sum, row) => sum + row.amount, 0),
      qualifiedSeconds: rows.reduce((sum, row) => sum + row.qualifiedSeconds, 0),
      settlements: rows,
    };
  }

  public async refundTerm(termId: string, actorId: string, reason: string) {
    const term = await UserSubscriptionTerm.findById(termId);
    if (!term) throw new Error('Kỳ thuê bao không tồn tại.');
    if (term.status === 'REFUNDED') return term;
    term.status = 'REFUNDED';
    term.refundedAt = new Date();
    await term.save();
    await PaymentTransaction.updateOne({ _id: term.transactionId }, { $set: { failureReason: `REFUNDED: ${reason}` } });
    await this.audit(actorId, 'ADMIN', 'SUBSCRIPTION_TERM_REFUNDED', 'UserSubscriptionTerm', term._id.toString(), { reason });
    await this.publishTerm(term);
    return term;
  }

  public async getAdminTerms() {
    await this.refreshTermStatuses();
    return UserSubscriptionTerm.find().sort({ createdAt: -1 }).lean();
  }

  private async publishTerm(term: IUserSubscriptionTerm) {
    await publishSubscriptionTermChanged({
      termId: term._id.toString(),
      userId: term.userId,
      planId: term.planId,
      planType: term.planType,
      status: term.status,
      startsAt: term.startsAt.toISOString(),
      endsAt: term.endsAt.toISOString(),
      transactionCode: term.transactionCode,
    });
  }

  private async audit(actorId: string, actorRole: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
    await SubscriptionAudit.create({ actorId, actorRole, action, entityType, entityId, details });
  }

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 86400000);
  }

  private periodBounds(period: string) {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Kỳ settlement phải có định dạng YYYY-MM.');
    const [year, month] = period.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1) throw new Error('Kỳ settlement không hợp lệ.');
    return { start, end };
  }
}

export default new SubscriptionService();
