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
};

export type CouponValidationResult = {
  coupon: ICoupon;
  subtotal: number;
  discountAmount: number;
  finalAmount: number;
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

    const now = new Date();
    if (query?.status === 'active') {
      filter.isActive = true;
      filter.$and = [
        { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
      ];
    } else if (query?.status === 'inactive') {
      filter.isActive = false;
    } else if (query?.status === 'expired') {
      filter.endsAt = { $lt: now };
    }

    const page = Math.max(Number(query?.page || 1), 1);
    const limit = Math.min(Math.max(Number(query?.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const [coupons, total] = await Promise.all([
      Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Coupon.countDocuments(filter),
    ]);

    return {
      coupons: coupons.map((coupon) => this.mapCoupon(coupon)),
      total,
      page,
      limit,
    };
  }

  public async createCoupon(input: CouponInput, adminId: string) {
    const payload = this.normalizeInput(input);
    const existing = await Coupon.findOne({ code: payload.code });
    if (existing) throw new Error('Mã coupon đã tồn tại.');

    const coupon = await Coupon.create({
      ...payload,
      createdBy: adminId,
      updatedBy: adminId,
    });
    return this.mapCoupon(coupon);
  }

  public async updateCoupon(id: string, input: Partial<CouponInput>, adminId: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Coupon không hợp lệ.');
    const payload = this.normalizeInput(input, true);
    if (payload.code) {
      const existing = await Coupon.findOne({ code: payload.code, _id: { $ne: id } });
      if (existing) throw new Error('Mã coupon đã tồn tại.');
    }

    const coupon = await Coupon.findByIdAndUpdate(
      id,
      { $set: { ...payload, updatedBy: adminId } },
      { new: true }
    );
    if (!coupon) throw new Error('Coupon không tồn tại.');
    return this.mapCoupon(coupon);
  }

  public async updateStatus(id: string, isActive: boolean, adminId: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Coupon không hợp lệ.');
    const coupon = await Coupon.findByIdAndUpdate(
      id,
      { $set: { isActive, updatedBy: adminId } },
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

  public async validateForCheckout(code: string, userId: string, subtotal: number): Promise<CouponValidationResult> {
    const normalizedCode = this.normalizeCode(code);
    if (!normalizedCode) throw new Error('Vui lòng nhập mã coupon.');
    if (subtotal <= 0) throw new Error('Giỏ hàng không có giá trị để áp dụng coupon.');

    const coupon = await Coupon.findOne({ code: normalizedCode });
    if (!coupon) throw new Error('Mã coupon không tồn tại.');
    this.assertCouponUsable(coupon, subtotal);

    const userUsage = await CouponRedemption.countDocuments({ couponId: coupon._id.toString(), userId });
    if (userUsage >= coupon.perUserLimit) {
      throw new Error('Bạn đã sử dụng hết lượt cho mã coupon này.');
    }

    const discountAmount = this.calculateDiscount(coupon, subtotal);
    if (discountAmount <= 0) throw new Error('Mã coupon không tạo ra giảm giá cho đơn hàng này.');

    return {
      coupon,
      subtotal,
      discountAmount,
      finalAmount: Math.max(subtotal - discountAmount, 0),
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
      createdBy: coupon.createdBy,
      updatedBy: coupon.updatedBy,
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
    };
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
    if (payload.startsAt && payload.endsAt && payload.startsAt > payload.endsAt) {
      throw new Error('Ngày bắt đầu phải trước ngày kết thúc.');
    }

    return payload;
  }

  private assertCouponUsable(coupon: ICoupon, subtotal: number): void {
    const now = new Date();
    if (!coupon.isActive) throw new Error('Mã coupon đã bị tạm dừng.');
    if (coupon.startsAt && coupon.startsAt > now) throw new Error('Mã coupon chưa đến thời gian sử dụng.');
    if (coupon.endsAt && coupon.endsAt < now) throw new Error('Mã coupon đã hết hạn.');
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new Error('Mã coupon đã hết lượt sử dụng.');
    }
    if (subtotal < coupon.minOrderAmount) {
      throw new Error(`Đơn hàng cần tối thiểu ${coupon.minOrderAmount.toLocaleString('vi-VN')} ₫ để dùng mã này.`);
    }
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
