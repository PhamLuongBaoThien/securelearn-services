// ========================
// Coupon Service
// Mục đích:
// - gom toàn bộ nghiệp vụ coupon cho Admin và learner ở payment-service
// - chuẩn hóa validate, tính giảm giá, giới hạn sử dụng và ghi nhận redemption
// Dùng cho:
// - admin CRUD coupon
// - validate coupon trước checkout
// - record usage sau khi thanh toán thành công
// ========================
import { Types } from 'mongoose';
import { Coupon, CouponType, ICoupon } from '../models/coupon.model';
import { CouponRedemption } from '../models/couponRedemption.model';

export type CouponComputedStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'INACTIVE' | 'USED_UP';

export type CouponInput = {
  code: string;
  name: string;
  type: CouponType;
  value: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number;
  usageLimit?: number | null;
  perUserLimit?: number;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  isActive?: boolean;
  combinable?: boolean;
};

export type CouponValidationResult = {
  coupon: ICoupon;
  subtotal: number;
  discountAmount: number;
  finalAmount: number;
};

type EvaluatedCoupon = {
  coupon: ICoupon;
  subtotal: number;
  discountAmount: number;
  finalAmount: number;
  reasonIfUnavailable?: string;
};

class CouponService {
  public async listAdminCoupons(query?: { search?: string; status?: string; page?: number; limit?: number }) {
    const filter: Record<string, any> = {};
    const search = String(query?.search || '').trim();
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      filter.$or = [{ code: searchRegex }, { name: searchRegex }];
    }

    const normalizedStatus = String(query?.status || '').toUpperCase();
    this.applyStatusFilter(filter, normalizedStatus);

    const page = Math.max(Number(query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(query?.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const coupons = await Coupon.find(filter).sort({ createdAt: -1 });
    const filteredCoupons = this.filterComputedStatus(coupons, normalizedStatus);
    const pagedCoupons = filteredCoupons.slice(skip, skip + limit);

    return {
      coupons: pagedCoupons.map((coupon) => this.mapCoupon(coupon)),
      total: filteredCoupons.length,
      page,
      limit,
    };
  }

  public async createCoupon(input: CouponInput, adminId: string, adminName = '') {
    const payload = this.normalizeInput(input);
    const existing = await Coupon.findOne({ code: payload.code });
    if (existing) throw new Error('Mã coupon đã tồn tại.');

    const coupon = await Coupon.create({
      ...payload,
      createdBy: adminId,
      createdByName: adminName,
      updatedBy: adminId,
      updatedByName: adminName,
    });
    return this.mapCoupon(coupon);
  }

  public async updateCoupon(id: string, input: Partial<CouponInput>, adminId: string, adminName = '') {
    if (!Types.ObjectId.isValid(id)) throw new Error('Coupon không hợp lệ.');
    const payload = this.normalizeInput(input, true);
    if (payload.code) {
      const existing = await Coupon.findOne({ code: payload.code, _id: { $ne: id } });
      if (existing) throw new Error('Mã coupon đã tồn tại.');
    }

    const coupon = await Coupon.findByIdAndUpdate(
      id,
      { $set: { ...payload, updatedBy: adminId, updatedByName: adminName } },
      { new: true }
    );
    if (!coupon) throw new Error('Coupon không tồn tại.');
    return this.mapCoupon(coupon);
  }

  public async updateStatus(id: string, isActive: boolean, adminId: string, adminName = '') {
    if (!Types.ObjectId.isValid(id)) throw new Error('Coupon không hợp lệ.');
    const coupon = await Coupon.findByIdAndUpdate(
      id,
      { $set: { isActive, updatedBy: adminId, updatedByName: adminName } },
      { new: true }
    );
    if (!coupon) throw new Error('Coupon không tồn tại.');
    return this.mapCoupon(coupon);
  }

  public async deleteCoupon(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Coupon không hợp lệ.');
    const redeemed = await CouponRedemption.exists({ couponId: id });
    if (redeemed) throw new Error('Coupon đã được sử dụng, chỉ có thể tạm dừng.');
    const deleted = await Coupon.findByIdAndDelete(id);
    if (!deleted) throw new Error('Coupon không tồn tại.');
  }

  public async getAvailableCoupons(userId: string | undefined, subtotal: number) {
    if (subtotal <= 0) return { coupons: [], subtotal };
    const coupons = await Coupon.find({}).sort({ endsAt: 1, createdAt: -1 });
    const evaluated = await Promise.all(coupons.map((coupon) => this.evaluateCoupon(coupon, userId, subtotal)));
    return {
      subtotal,
      coupons: evaluated
        .filter((entry) => !entry.reasonIfUnavailable && entry.discountAmount > 0)
        .map((entry) => this.mapEvaluatedCoupon(entry)),
    };
  }

  public async getBestCoupon(userId: string | undefined, subtotal: number) {
    const available = await this.getAvailableCoupons(userId, subtotal);
    const best = available.coupons
      .slice()
      .sort((a: any, b: any) => {
        if (a.finalAmount !== b.finalAmount) return a.finalAmount - b.finalAmount;
        if (a.discountAmount !== b.discountAmount) return b.discountAmount - a.discountAmount;
        const aEnds = a.endsAt ? new Date(a.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bEnds = b.endsAt ? new Date(b.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aEnds - bEnds;
      })[0];

    return {
      subtotal,
      coupon: best || null,
    };
  }


  public async getBestCouponPreview(subtotal: number, userId?: string) {
    const normalizedSubtotal = Math.max(Math.floor(Number(subtotal || 0)), 0);
    if (normalizedSubtotal <= 0) return { subtotal: normalizedSubtotal, coupon: null };
    return this.getBestCoupon(userId, normalizedSubtotal);
  }

  public async getBestCouponPreviews(items: Array<{ courseId?: string; price?: number }>, userId?: string) {
    const normalizedItems = items
      .map((item) => ({
        courseId: String(item.courseId || '').trim(),
        subtotal: Math.max(Math.floor(Number(item.price || 0)), 0),
      }))
      .filter((item) => item.courseId && item.subtotal > 0)
      .slice(0, 100);

    if (normalizedItems.length === 0) return { previews: {} };

    const coupons = await Coupon.find({}).sort({ endsAt: 1, createdAt: -1 });
    const previews: Record<string, { subtotal: number; coupon: ReturnType<CouponService['mapCoupon']> | null }> = {};

    await Promise.all(normalizedItems.map(async (item) => {
      const evaluated = await Promise.all(coupons.map((coupon) => this.evaluateCoupon(coupon, userId, item.subtotal)));
      const best = evaluated
        .filter((entry) => !entry.reasonIfUnavailable && entry.discountAmount > 0)
        .map((entry) => this.mapEvaluatedCoupon(entry))
        .sort((a: any, b: any) => {
          if (a.finalAmount !== b.finalAmount) return a.finalAmount - b.finalAmount;
          if (a.discountAmount !== b.discountAmount) return b.discountAmount - a.discountAmount;
          const aEnds = a.endsAt ? new Date(a.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bEnds = b.endsAt ? new Date(b.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
          return aEnds - bEnds;
        })[0] || null;

      previews[item.courseId] = {
        subtotal: item.subtotal,
        coupon: best,
      };
    }));

    return { previews };
  }
  public async validateForCheckout(code: string, userId: string, subtotal: number): Promise<CouponValidationResult> {
    const normalizedCode = this.normalizeCode(code);
    if (!normalizedCode) throw new Error('Vui lòng nhập mã coupon.');
    if (subtotal <= 0) throw new Error('Giỏ hàng không có giá trị để áp dụng coupon.');

    const coupon = await Coupon.findOne({ code: normalizedCode });
    if (!coupon) throw new Error('Mã coupon không tồn tại.');
    const evaluated = await this.evaluateCoupon(coupon, userId, subtotal);
    if (evaluated.reasonIfUnavailable) throw new Error(evaluated.reasonIfUnavailable);
    if (evaluated.discountAmount <= 0) throw new Error('Mã coupon không tạo ra giảm giá cho đơn hàng này.');

    return {
      coupon,
      subtotal,
      discountAmount: evaluated.discountAmount,
      finalAmount: evaluated.finalAmount,
    };
  }

  public async listRedemptions(query?: { couponId?: string; code?: string; user?: string; page?: number; limit?: number }) {
    const filter: Record<string, any> = {};
    if (query?.couponId) {
      if (!Types.ObjectId.isValid(query.couponId)) throw new Error('Coupon không hợp lệ.');
      filter.couponId = query.couponId;
    }
    if (query?.code) {
      const escapedCode = String(query.code).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.code = new RegExp(escapedCode, 'i');
    }
    if (query?.user) {
      const escapedUser = String(query.user).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.userId = new RegExp(escapedUser, 'i');
    }

    const page = Math.max(Number(query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(query?.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const [redemptions, total] = await Promise.all([
      CouponRedemption.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CouponRedemption.countDocuments(filter),
    ]);

    return {
      redemptions: redemptions.map((item) => ({
        _id: item._id.toString(),
        couponId: item.couponId,
        couponCode: item.code,
        userId: item.userId,
        transactionId: item.transactionId,
        transactionCode: item.transactionCode,
        discountAmount: item.discountAmount,
        createdAt: item.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  public async getCouponStats(couponId?: string) {
    if (couponId && !Types.ObjectId.isValid(couponId)) throw new Error('Coupon không hợp lệ.');
    const couponFilter = couponId ? { _id: couponId } : {};
    const redemptionFilter = couponId ? { couponId } : {};
    const [coupons, redemptions, discountAggregate, topByDiscount] = await Promise.all([
      Coupon.find(couponFilter),
      CouponRedemption.find(redemptionFilter).lean(),
      CouponRedemption.aggregate([
        { $match: redemptionFilter },
        { $group: { _id: null, totalDiscountAmount: { $sum: '$discountAmount' }, totalRedemptions: { $sum: 1 } } },
      ]),
      CouponRedemption.aggregate([
        { $match: redemptionFilter },
        { $group: { _id: { couponId: '$couponId', code: '$code' }, totalDiscountAmount: { $sum: '$discountAmount' }, redemptions: { $sum: 1 } } },
        { $sort: { totalDiscountAmount: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const statusCounts = coupons.reduce(
      (acc, coupon) => {
        const status = this.getComputedStatus(coupon);
        acc[status] += 1;
        return acc;
      },
      { ACTIVE: 0, SCHEDULED: 0, EXPIRED: 0, INACTIVE: 0, USED_UP: 0 } as Record<CouponComputedStatus, number>
    );

    const uniqueUsers = new Set(redemptions.map((item) => item.userId)).size;
    const aggregate = discountAggregate[0] || { totalDiscountAmount: 0, totalRedemptions: 0 };
    const topByUsage = coupons
      .slice()
      .sort((a, b) => b.usedCount - a.usedCount)
      .slice(0, 5)
      .map((coupon) => ({
        couponId: coupon._id.toString(),
        code: coupon.code,
        usedCount: coupon.usedCount,
        computedStatus: this.getComputedStatus(coupon),
      }));

    return {
      totalCoupons: coupons.length,
      statusCounts,
      totalRedemptions: aggregate.totalRedemptions || 0,
      totalDiscountAmount: aggregate.totalDiscountAmount || 0,
      uniqueUsers,
      topByUsage,
      topByDiscount: topByDiscount.map((item) => ({
        couponId: item._id.couponId,
        code: item._id.code,
        totalDiscountAmount: item.totalDiscountAmount,
        redemptions: item.redemptions,
      })),
    };
  }

  public async recordRedemption(input: {
    couponId: string;
    code: string;
    userId: string;
    transactionId: string;
    transactionCode: string;
    discountAmount: number;
  }) {
    const existing = await CouponRedemption.findOne({ transactionCode: input.transactionCode });
    if (existing) return;

    await CouponRedemption.create(input);
    await Coupon.updateOne({ _id: input.couponId }, { $inc: { usedCount: 1 } });
  }

  public mapCoupon(coupon: ICoupon) {
    return {
      _id: coupon._id.toString(),
      code: coupon.code,
      name: coupon.name,
      type: coupon.type,
      value: coupon.value,
      maxDiscountAmount: coupon.maxDiscountAmount ?? null,
      minOrderAmount: coupon.minOrderAmount,
      usageLimit: coupon.usageLimit ?? null,
      usedCount: coupon.usedCount,
      perUserLimit: coupon.perUserLimit,
      startsAt: coupon.startsAt ?? null,
      endsAt: coupon.endsAt ?? null,
      isActive: coupon.isActive,
      combinable: coupon.combinable ?? false,
      computedStatus: this.getComputedStatus(coupon),
      createdBy: coupon.createdBy,
      createdByName: coupon.createdByName || '',
      updatedBy: coupon.updatedBy,
      updatedByName: coupon.updatedByName || '',
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
    };
  }

  private mapEvaluatedCoupon(entry: EvaluatedCoupon) {
    return {
      ...this.mapCoupon(entry.coupon),
      subtotal: entry.subtotal,
      discountAmount: entry.discountAmount,
      discountPreview: entry.discountAmount,
      finalAmount: entry.finalAmount,
      reasonIfUnavailable: entry.reasonIfUnavailable || '',
    };
  }

  private async evaluateCoupon(coupon: ICoupon, userId: string | undefined, subtotal: number): Promise<EvaluatedCoupon> {
    const reasonIfUnavailable = await this.getUnavailableReason(coupon, userId, subtotal);
    const discountAmount = reasonIfUnavailable ? 0 : this.calculateDiscount(coupon, subtotal);
    return {
      coupon,
      subtotal,
      discountAmount,
      finalAmount: Math.max(subtotal - discountAmount, 0),
      reasonIfUnavailable,
    };
  }

  private async getUnavailableReason(coupon: ICoupon, userId: string | undefined, subtotal: number): Promise<string> {
    const status = this.getComputedStatus(coupon);
    if (subtotal <= 0) return 'Giỏ hàng không có giá trị để áp dụng coupon.';
    if (status === 'INACTIVE') return 'Mã coupon đã bị tạm dừng.';
    if (status === 'SCHEDULED') return 'Mã coupon chưa đến thời gian sử dụng.';
    if (status === 'EXPIRED') return 'Mã coupon đã hết hạn.';
    if (status === 'USED_UP') return 'Mã coupon đã hết lượt sử dụng.';
    if (subtotal < coupon.minOrderAmount) return `Đơn hàng cần tối thiểu ${coupon.minOrderAmount.toLocaleString('vi-VN')} ₫ để dùng mã này.`;

    if (userId) {
      const userUsage = await CouponRedemption.countDocuments({ couponId: coupon._id.toString(), userId });
      if (userUsage >= coupon.perUserLimit) return 'Bạn đã sử dụng hết lượt cho mã coupon này.';
    }
    return '';
  }

  private getComputedStatus(coupon: ICoupon): CouponComputedStatus {
    const now = new Date();
    if (!coupon.isActive) return 'INACTIVE';
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return 'USED_UP';
    if (coupon.startsAt && coupon.startsAt > now) return 'SCHEDULED';
    if (coupon.endsAt && coupon.endsAt < now) return 'EXPIRED';
    return 'ACTIVE';
  }

  private applyStatusFilter(filter: Record<string, any>, normalizedStatus: string): void {
    const now = new Date();
    if (['INACTIVE', 'INACTIVE', 'TAM_DUNG'].includes(normalizedStatus)) filter.isActive = false;
    if (normalizedStatus === 'ACTIVE') {
      filter.isActive = true;
      filter.$and = [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
      ];
    }
    if (normalizedStatus === 'SCHEDULED') {
      filter.isActive = true;
      filter.startsAt = { $gt: now };
    }
    if (normalizedStatus === 'EXPIRED') filter.endsAt = { $lt: now };
    if (normalizedStatus === 'USED_UP') filter.$expr = { $gte: ['$usedCount', '$usageLimit'] };
  }

  private filterComputedStatus(coupons: ICoupon[], normalizedStatus: string): ICoupon[] {
    if (!normalizedStatus || ['ACTIVE', 'SCHEDULED', 'EXPIRED', 'INACTIVE', 'USED_UP'].includes(normalizedStatus)) {
      if (!normalizedStatus) return coupons;
      return coupons.filter((coupon) => this.getComputedStatus(coupon) === normalizedStatus);
    }
    return coupons;
  }

  private normalizeInput(input: Partial<CouponInput>, partial = false): Partial<CouponInput> & { code?: string } {
    const payload: Record<string, any> = {};

    if (!partial || input.code !== undefined) {
      const code = this.normalizeCode(input.code || '');
      if (!code) throw new Error('Vui lòng nhập mã coupon.');
      payload.code = code;
    }
    if (!partial || input.name !== undefined) {
      const name = String(input.name || '').trim();
      if (!name) throw new Error('Vui lòng nhập tên coupon.');
      payload.name = name;
    }
    if (!partial || input.type !== undefined) {
      if (!['PERCENT', 'FIXED'].includes(String(input.type))) {
        throw new Error('Loại coupon không hợp lệ.');
      }
      payload.type = input.type;
    }
    if (!partial || input.value !== undefined) {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Giá trị giảm phải lớn hơn 0.');
      if ((input.type || payload.type) === 'PERCENT' && value > 100) {
        throw new Error('Coupon phần trăm không được vượt quá 100%.');
      }
      payload.value = Math.floor(value);
    }

    if (input.maxDiscountAmount !== undefined) {
      payload.maxDiscountAmount = input.maxDiscountAmount === null || input.maxDiscountAmount === undefined
        ? undefined
        : Math.max(Math.floor(Number(input.maxDiscountAmount)), 0);
    }
    if (input.minOrderAmount !== undefined || !partial) {
      payload.minOrderAmount = Math.max(Math.floor(Number(input.minOrderAmount || 0)), 0);
    }
    if (input.usageLimit !== undefined) {
      payload.usageLimit = input.usageLimit === null || input.usageLimit === undefined
        ? undefined
        : Math.max(Math.floor(Number(input.usageLimit)), 1);
    }
    if (input.perUserLimit !== undefined || !partial) {
      payload.perUserLimit = Math.max(Math.floor(Number(input.perUserLimit || 1)), 1);
    }
    if (input.startsAt !== undefined) payload.startsAt = input.startsAt ? new Date(input.startsAt) : undefined;
    if (input.endsAt !== undefined) payload.endsAt = input.endsAt ? new Date(input.endsAt) : undefined;
    if (input.isActive !== undefined) payload.isActive = Boolean(input.isActive);
    if (input.combinable !== undefined) payload.combinable = Boolean(input.combinable);
    if (payload.startsAt && payload.endsAt && payload.startsAt > payload.endsAt) {
      throw new Error('Ngày bắt đầu phải trước ngày kết thúc.');
    }

    return payload;
  }

  private calculateDiscount(coupon: ICoupon, subtotal: number): number {
    const rawDiscount = coupon.type === 'PERCENT'
      ? Math.floor((subtotal * coupon.value) / 100)
      : coupon.value;
    const cappedByMax = coupon.maxDiscountAmount
      ? Math.min(rawDiscount, coupon.maxDiscountAmount)
      : rawDiscount;
    return Math.min(Math.max(cappedByMax, 0), subtotal);
  }

  private normalizeCode(code: string): string {
    return String(code || '').trim().toUpperCase();
  }
}

export default new CouponService();




