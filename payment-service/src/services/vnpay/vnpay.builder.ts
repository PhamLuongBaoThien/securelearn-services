// ========================
// VNPay Payment URL Builder
// Mục đích:
// - build URL redirect thanh toán VNPay đúng chuẩn 2.1.0
// - tạo checksum HMAC-SHA512 cho toàn bộ query
// Hàm chính:
// - buildVnpayPaymentUrl(): trả về URL thanh toán VNPay tuyệt đối
// ========================
import crypto from 'crypto';
import { getVnpayConfig } from './vnpay.config';

type BuildVnpayPaymentUrlInput = {
  txnRef: string;
  amount: number;
  orderInfo: string;
  ipAddr: string;
  bankCode?: string;
  createDate?: Date;
};

// VNPay yêu cầu thời gian theo GMT+7, format: YYYYMMDDHHmmss
const formatVnpayDateTime = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  // Convert UTC → GMT+7
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return [
    gmt7.getUTCFullYear(),
    pad(gmt7.getUTCMonth() + 1),
    pad(gmt7.getUTCDate()),
    pad(gmt7.getUTCHours()),
    pad(gmt7.getUTCMinutes()),
    pad(gmt7.getUTCSeconds()),
  ].join('');
};

// Mô phỏng PHP urlencode(): encode value, space → '+'
// Dùng cho cả URL query string và chuỗi hash data (giống PHP demo VNPay)
const phpUrlEncode = (value: string): string =>
  encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

export const buildVnpayPaymentUrl = (input: BuildVnpayPaymentUrlInput): string => {
  const config = getVnpayConfig();
  const now = input.createDate || new Date();
  const expireAt = new Date(now.getTime() + config.expireMinutes * 60 * 1000);

  const params: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: config.tmnCode,
    vnp_Amount: String(Math.round(input.amount) * 100),
    vnp_CurrCode: config.currency,
    vnp_TxnRef: input.txnRef,
    vnp_OrderInfo: input.orderInfo,
    vnp_OrderType: config.orderType,
    vnp_Locale: config.locale,
    vnp_ReturnUrl: config.returnUrl,
    vnp_IpAddr: input.ipAddr,
    vnp_CreateDate: formatVnpayDateTime(now),
    vnp_ExpireDate: formatVnpayDateTime(expireAt),
  };


  if (input.bankCode) {
    params.vnp_BankCode = input.bankCode;
  }

  // Sort key theo alphabet — bắt buộc theo spec VNPay
  const sortedKeys = Object.keys(params).sort();

  // Chuỗi hash data: key=phpUrlEncode(value) — khớp với cách VNPay ký trên query đã encode
  const hashData = sortedKeys
    .map((key) => `${key}=${phpUrlEncode(params[key])}`)
    .join('&');

  // URL query string: encode cả key lẫn value để browser xử lý đúng
  const queryString = sortedKeys
    .map((key) => `${phpUrlEncode(key)}=${phpUrlEncode(params[key])}`)
    .join('&');

  const secureHash = crypto
    .createHmac('sha512', config.hashSecret)
    .update(Buffer.from(hashData, 'utf-8'))
    .digest('hex');

  return `${config.paymentUrl}?${queryString}&vnp_SecureHash=${secureHash}`;
};
