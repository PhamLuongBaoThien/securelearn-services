// ========================
// Subscription Service
// Mục đích:
// - quản lý lifecycle của plan, term, usage và settlement thuê bao
// - tạo snapshot kế toán để dữ liệu doanh thu lịch sử không bị lệch khi config đổi sau này
// ========================
import { PaymentTransaction, type IPaymentTransaction } from '../models/paymentTransaction.model';
import { SubscriptionPlan, type SubscriptionPlanType } from '../models/subscriptionPlan.model';
import { SubscriptionSettlement, type SubscriptionSettlementStatus } from '../models/subscriptionSettlement.model';
import { SubscriptionUsage, type ISubscriptionUsageInterval } from '../models/subscriptionUsage.model';
import { UserSubscriptionTerm, type IUserSubscriptionTerm } from '../models/userSubscriptionTerm.model';
import { PurchaseAccessCutover } from '../models/purchaseAccessCutover.model';
import { publishSubscriptionTermChanged, publishSubscriptionSettlementAvailable } from '../events/publishers';

const MAX_HEARTBEAT_SECONDS = 15;
const MAX_USAGE_UPDATE_RETRIES = 5;

type NormalizedInterval = ISubscriptionUsageInterval;

const normalizeUsageInterval = (rangeStartSeconds: number, rangeEndSeconds: number, qualifiedSeconds: number): NormalizedInterval | null => {
  const rawStart = Number(rangeStartSeconds);
  const rawEnd = Number(rangeEndSeconds);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;

  const start = Math.max(0, Math.floor(rawStart));
  const requestedEnd = Math.max(start, Math.ceil(rawEnd));
  const qualifiedLimit = Math.max(0, Math.floor(Number(qualifiedSeconds)));
  const cappedDuration = Math.min(MAX_HEARTBEAT_SECONDS, qualifiedLimit, requestedEnd - start);
  if (cappedDuration <= 0) return null;

  return { start, end: start + cappedDuration };
};

const mergeIntervals = (intervals: ISubscriptionUsageInterval[], next: ISubscriptionUsageInterval): ISubscriptionUsageInterval[] => {
  const sorted = [...intervals, next]
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .map((item) => ({ start: Math.max(0, Math.floor(item.start)), end: Math.max(0, Math.ceil(item.end)) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: ISubscriptionUsageInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push(interval);
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }
  return merged;
};

const sumIntervals = (intervals: ISubscriptionUsageInterval[]): number => intervals.reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0);

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
  qualifiedSeconds: number;
  courseTitle?: string;
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  eventId: string;
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

  public async upsertPlan(input: PlanInput) {
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
    if (!input.eventId || Number.isNaN(occurredAt.getTime())) throw new Error('Usage event không hợp lệ.');
    const term = await UserSubscriptionTerm.findOne({
      _id: input.termId, userId: input.userId, status: { $in: ['ACTIVE', 'EXPIRED'] }, startsAt: { $lte: occurredAt }, endsAt: { $gt: occurredAt },
    });
    if (!term) throw new Error('Kỳ thuê bao không còn hiệu lực.');
    const cutover = await PurchaseAccessCutover.findOne({ userId: input.userId, courseId: input.courseId, effectiveAt: { $lte: occurredAt } }).lean();
    if (cutover) return { usageId: input.eventId, duplicate: false, acceptedSeconds: 0, rejectedByPurchase: true };

    const interval = normalizeUsageInterval(input.rangeStartSeconds, input.rangeEndSeconds, input.qualifiedSeconds);
    if (!interval) {
      return { usageId: input.eventId, duplicate: false, acceptedSeconds: 0, rejectedByPurchase: false };
    }

    const originalPeriod = this.periodFor(occurredAt);
    let settlementPeriod = originalPeriod;
    while (await SubscriptionSettlement.exists({ period: settlementPeriod, status: { $in: ['LOCKED', 'AVAILABLE'] } })) {
      settlementPeriod = this.nextPeriodString(settlementPeriod);
    }

    const identity = {
      termId: input.termId,
      userId: input.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      instructorId: input.instructorId,
    };

    for (let attempt = 0; attempt < MAX_USAGE_UPDATE_RETRIES; attempt += 1) {
      const existing = await SubscriptionUsage.findOne(identity).lean();
      if (!existing) {
        try {
          await SubscriptionUsage.create({
            ...identity,
            courseTitle: input.courseTitle || '',
            intervals: [interval],
            qualifiedSeconds: interval.end - interval.start,
            periodUsages: [{ period: settlementPeriod, qualifiedSeconds: interval.end - interval.start }],
            version: 1,
          });
          return { usageId: input.eventId, duplicate: false, acceptedSeconds: interval.end - interval.start, rejectedByPurchase: false };
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          continue;
        }
      }

      const merged = mergeIntervals(existing.intervals || [], interval);
      const qualifiedSeconds = sumIntervals(merged);
      const acceptedSeconds = Math.max(0, qualifiedSeconds - (existing.qualifiedSeconds || 0));
      const periodUsages = [...(existing.periodUsages || [])];
      if (acceptedSeconds > 0) {
        const periodUsage = periodUsages.find((item) => item.period === settlementPeriod);
        if (periodUsage) periodUsage.qualifiedSeconds += acceptedSeconds;
        else periodUsages.push({ period: settlementPeriod, qualifiedSeconds: acceptedSeconds });
      }
      const result = await SubscriptionUsage.updateOne(
        { _id: existing._id, version: existing.version },
        {
          $set: {
            intervals: merged,
            qualifiedSeconds,
            periodUsages,
            courseTitle: input.courseTitle || existing.courseTitle || '',
          },
          $inc: { version: 1 },
        }
      );
      if (result.modifiedCount === 1) {
        return { usageId: input.eventId, duplicate: acceptedSeconds === 0, acceptedSeconds, rejectedByPurchase: false };
      }
    }

    throw new Error('Không thể ghi usage thuê bao do xung đột cập nhật, worker sẽ retry.');
  }
  public async finalizeSettlement(period: string) {
    const existing = await SubscriptionSettlement.findOne({ period });
    if (existing && ['LOCKED', 'AVAILABLE'].includes(existing.status)) return existing;
    const { start, end } = this.periodBounds(period);
    const terms = await UserSubscriptionTerm.find({ status: { $ne: 'REFUNDED' }, startsAt: { $lt: end }, endsAt: { $gt: start } }).lean();

    let recognizedGross = 0;
    let baseAdminRevenue = 0;
    let instructorPool = 0;
    let carriedIn = 0;
    let carriedOut = 0;
    let expiredToAdmin = 0;
    let totalQualifiedSeconds = 0;
    const aggregate = new Map<string, { instructorId: string; courseId: string; courseTitle: string; qualifiedSeconds: number; amount: number; terms: Set<string>; learners: Set<string> }>();
    const termLedgers: Array<{ termId: string; userId: string; recognizedPool: number; carryIn: number; allocatedAmount: number; carryOut: number; expiredToAdmin: number; totalQualifiedSeconds: number; allocations: Array<{ instructorId: string; courseId: string; courseTitle: string; qualifiedSeconds: number; amount: number }> }> = [];

    for (const term of terms) {
      const overlapMs = Math.max(0, Math.min(term.endsAt.getTime(), end.getTime()) - Math.max(term.startsAt.getTime(), start.getTime()));
      const ratio = overlapMs / (term.durationDays * 86400000);
      const termGross = Math.round(term.price * ratio);
      const termAdmin = Math.round(term.adminAmount * ratio);
      recognizedGross += termGross;
      baseAdminRevenue += termAdmin;

      const previousSettlements = await SubscriptionSettlement.find({
        period: { $lt: period },
        termLedgers: { $elemMatch: { termId: term._id.toString() } },
      }).sort({ period: -1 }).select('period termLedgers').lean();
      const previousLedgers = previousSettlements.flatMap((settlement) =>
        settlement.termLedgers.filter((item) => item.termId === term._id.toString())
      );
      const previousLedger = previousLedgers[0];
      const termCarryIn = previousLedger?.carryOut || 0;
      const previouslyRecognizedPool = previousLedgers.reduce((sum, ledger) => sum + ledger.recognizedPool, 0);
      const proportionalPool = Math.round(term.instructorPoolAmount * ratio);
      // Tháng cuối nhận đúng phần còn lại để tổng recognizedPool toàn term không lệch vì làm tròn từng tháng.
      const recognizedPool = term.endsAt <= end
        ? Math.max(0, term.instructorPoolAmount - previouslyRecognizedPool)
        : proportionalPool;
      instructorPool += recognizedPool;
      carriedIn += termCarryIn;
      const usage = await SubscriptionUsage.aggregate<{ _id: { instructorId: string; courseId: string; courseTitle: string }; qualifiedSeconds: number }>([
        { $match: { termId: term._id.toString(), 'periodUsages.period': period } },
        { $unwind: '$periodUsages' },
        { $match: { 'periodUsages.period': period } },
        { $group: { _id: { instructorId: '$instructorId', courseId: '$courseId', courseTitle: '$courseTitle' }, qualifiedSeconds: { $sum: '$periodUsages.qualifiedSeconds' } } },
        { $sort: { qualifiedSeconds: -1, '_id.courseId': 1 } },
      ]);
      const termSeconds = usage.reduce((sum, row) => sum + row.qualifiedSeconds, 0);
      const available = recognizedPool + termCarryIn;
      let termCarryOut = 0;
      let termExpiredToAdmin = 0;
      const termAllocations: Array<{ instructorId: string; courseId: string; courseTitle: string; qualifiedSeconds: number; amount: number }> = [];

      if (termSeconds > 0 && available > 0) {
        let allocated = 0;
        for (const row of usage) {
          const amount = Math.floor(available * row.qualifiedSeconds / termSeconds);
          allocated += amount;
          termAllocations.push({ ...row._id, qualifiedSeconds: row.qualifiedSeconds, amount });
        }
        const remainder = available - allocated;
        if (remainder > 0 && termAllocations.length) termAllocations[0].amount += remainder;
      } else if (term.endsAt <= end) {
        termExpiredToAdmin = available;
      } else {
        termCarryOut = available;
      }

      carriedOut += termCarryOut;
      expiredToAdmin += termExpiredToAdmin;
      totalQualifiedSeconds += termSeconds;
      for (const row of termAllocations) {
        const key = row.instructorId + ':' + row.courseId;
        const current = aggregate.get(key) || { ...row, qualifiedSeconds: 0, amount: 0, terms: new Set<string>(), learners: new Set<string>() };
        current.qualifiedSeconds += row.qualifiedSeconds;
        current.amount += row.amount;
        current.terms.add(term._id.toString());
        current.learners.add(term.userId);
        aggregate.set(key, current);
      }
      termLedgers.push({
        termId: term._id.toString(), userId: term.userId, recognizedPool, carryIn: termCarryIn,
        allocatedAmount: termAllocations.reduce((sum, row) => sum + row.amount, 0), carryOut: termCarryOut,
        expiredToAdmin: termExpiredToAdmin, totalQualifiedSeconds: termSeconds, allocations: termAllocations,
      });
    }

    const allocatedAmount = Array.from(aggregate.values()).reduce((sum, row) => sum + row.amount, 0);
    const allocations = Array.from(aggregate.values()).map(row => ({
      instructorId: row.instructorId, courseId: row.courseId, courseTitle: row.courseTitle,
      qualifiedSeconds: row.qualifiedSeconds, amount: row.amount, termCount: row.terms.size, learnerCount: row.learners.size,
      sharePercent: allocatedAmount > 0 ? Number(((row.amount / allocatedAmount) * 100).toFixed(4)) : 0,
    })).sort((a, b) => b.amount - a.amount || a.courseId.localeCompare(b.courseId));
    const adminRevenue = baseAdminRevenue + expiredToAdmin;
    const reconciliationDifference = instructorPool + carriedIn - allocatedAmount - carriedOut - expiredToAdmin;
    const settlement = await SubscriptionSettlement.findOneAndUpdate({ period }, { $set: {
      status: 'LOCKED', recognizedGross, adminRevenue, instructorPool, carriedIn, carriedOut, expiredToAdmin, allocatedAmount, reconciliationDifference,
      totalQualifiedSeconds, allocations, termLedgers, calculatedAt: new Date(), lockedAt: new Date(),
    } }, { upsert: true, new: true });
    return settlement;
  }
  public async updateSettlementStatus(period: string, status: SubscriptionSettlementStatus) {
    const settlement = await SubscriptionSettlement.findOne({ period });
    if (!settlement) throw new Error('Kỳ settlement không tồn tại.');
    if (settlement.status !== 'LOCKED' || status !== 'AVAILABLE') {
      throw new Error('Chỉ settlement đang chờ ghi nhận mới có thể chuyển sang khả dụng.');
    }

    settlement.status = 'AVAILABLE';
    settlement.availableAt = new Date();
    const grouped = new Map<string, { amount: number; qualifiedSeconds: number; courses: Set<string> }>();
    for (const row of settlement.allocations) {
      const value = grouped.get(row.instructorId) || { amount: 0, qualifiedSeconds: 0, courses: new Set<string>() };
      value.amount += row.amount;
      value.qualifiedSeconds += row.qualifiedSeconds;
      value.courses.add(row.courseId);
      grouped.set(row.instructorId, value);
    }
    await Promise.all(Array.from(grouped.entries()).map(([instructorId, value]) => publishSubscriptionSettlementAvailable({
      eventId: 'subscription-settlement:' + period + ':' + instructorId,
      instructorId,
      period,
      amount: value.amount,
      qualifiedSeconds: value.qualifiedSeconds,
      courseCount: value.courses.size,
      availableAt: settlement.availableAt!.toISOString(),
    })));
    await settlement.save();
    return settlement;
  }

  public async finalizeDueSettlements(now = new Date()) {
    const local = this.localDateParts(now);
    const currentPeriod = local.year + '-' + String(local.month).padStart(2, '0');
    const endExclusive = local.day === 1 && local.hour < 2
      ? this.previousPeriodString(currentPeriod)
      : currentPeriod;
    const earliest = await UserSubscriptionTerm.findOne({ status: { $ne: 'REFUNDED' } }).sort({ startsAt: 1 }).select('startsAt').lean();
    if (!earliest) return [];

    const finalized: string[] = [];
    let period = this.periodFor(earliest.startsAt);
    while (period < endExclusive) {
      const existing = await SubscriptionSettlement.findOne({ period }).select('status').lean();
      if (!existing || !['LOCKED', 'AVAILABLE'].includes(existing.status as string)) {
        await this.finalizeSettlement(period);
        finalized.push(period);
      }
      period = this.nextPeriodString(period);
    }
    return finalized;
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

    const currentPeriod = this.periodFor(new Date());
    const currentUsage = await SubscriptionUsage.aggregate<{
      _id: { courseId: string; courseTitle: string };
      qualifiedSeconds: number;
      learnerIds: string[];
    }>([
      { $match: { instructorId, 'periodUsages.period': currentPeriod } },
      { $unwind: '$periodUsages' },
      { $match: { 'periodUsages.period': currentPeriod } },
      { $group: {
        _id: { courseId: '$courseId', courseTitle: '$courseTitle' },
        qualifiedSeconds: { $sum: '$periodUsages.qualifiedSeconds' },
        learnerIds: { $addToSet: '$userId' },
      } },
      { $sort: { qualifiedSeconds: -1, '_id.courseId': 1 } },
    ]);
    const currentQualifiedSeconds = currentUsage.reduce((sum, row) => sum + row.qualifiedSeconds, 0);

    return {
      pending: rows.filter((row) => row.status === 'LOCKED').reduce((sum, row) => sum + row.amount, 0),
      available: rows.filter((row) => row.status === 'AVAILABLE').reduce((sum, row) => sum + row.amount, 0),
      currentQualifiedSeconds,
      currentUsage: currentUsage.map((row) => ({
        period: currentPeriod,
        courseId: row._id.courseId,
        courseTitle: row._id.courseTitle,
        qualifiedSeconds: row.qualifiedSeconds,
        learnerCount: row.learnerIds.length,
      })),
      settlements: rows,
    };
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

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 86400000);
  }

  private periodFor(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    if (!year || !month) throw new Error('Không thể xác định kỳ thuê bao.');
    return year + '-' + month;
  }

  private localDateParts(date: Date) {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
    };
  }

  private periodBounds(period: string) {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Kỳ settlement phải có định dạng YYYY-MM.');
    const [year, month] = period.split('-').map(Number);
    if (month < 1 || month > 12) throw new Error('Kỳ settlement không hợp lệ.');
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const start = new Date(
      String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-01T00:00:00+07:00'
    );
    const end = new Date(
      String(nextYear).padStart(4, '0') + '-' + String(nextMonth).padStart(2, '0') + '-01T00:00:00+07:00'
    );
    return { start, end };
  }

  private nextPeriodString(period: string) {
    const [year, month] = period.split('-').map(Number);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return String(nextYear).padStart(4, '0') + '-' + String(nextMonth).padStart(2, '0');
  }

  private previousPeriodString(period: string) {
    const [year, month] = period.split('-').map(Number);
    const previousYear = month === 1 ? year - 1 : year;
    const previousMonth = month === 1 ? 12 : month - 1;
    return String(previousYear).padStart(4, '0') + '-' + String(previousMonth).padStart(2, '0');
  }
}

export default new SubscriptionService();
