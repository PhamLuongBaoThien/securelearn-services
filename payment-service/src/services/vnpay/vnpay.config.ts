// ========================
// VNPay Config
// Mục đích:
// - gom cấu hình VNPay vào một nơi để builder/verifier dùng chung
// - đọc env một lần, đảm bảo payment URL và checksum secret nhất quán
// Hàm chính:
// - getVnpayConfig(): trả về cấu hình VNPay đã chuẩn hóa
// - verifyVnpaySignature(): xác thực chữ ký VNPay
// ========================

export type VnpayConfig = {
  paymentUrl: string;
  tmnCode: string;
  hashSecret: string;
  returnUrl: string;
  locale: string;
  currency: string;
  orderType: string;
  ipnUrl?: string;
  expireMinutes: number;
};


export const getVnpayConfig = (): VnpayConfig => {
  const paymentUrl = process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  const tmnCode = process.env.VNPAY_TMN_CODE || '';
  const hashSecret = process.env.VNPAY_HASH_SECRET || '';
  const returnUrl = process.env.VNPAY_RETURN_URL || `${process.env.CLIENT_URL || 'http://localhost:5173'}/payment/vnpay-return`;
  const locale = process.env.VNPAY_LOCALE || 'vn';
  const currency = process.env.VNPAY_CURRENCY || 'VND';
  const orderType = process.env.VNPAY_ORDER_TYPE || 'other';
  const ipnUrl = process.env.VNPAY_IPN_URL || '';
  const expireMinutes = Number(process.env.VNPAY_EXPIRE_MINUTES || '15');

  if (!tmnCode) {
    throw new Error('VNPAY_TMN_CODE is not defined in environment variables');
  }
  if (!hashSecret) {
    throw new Error('VNPAY_HASH_SECRET is not defined in environment variables');
  }

  return {
    paymentUrl,
    tmnCode,
    hashSecret,
    returnUrl,
    locale,
    currency,
    orderType,
    ipnUrl,
    expireMinutes: Number.isFinite(expireMinutes) && expireMinutes > 0 ? expireMinutes : 15,
  };
};
