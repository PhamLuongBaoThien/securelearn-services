// ========================
// VNPay Signature Verifier
// Mục đích:
// - verify checksum cho Return/IPN query của VNPay
// - bảo vệ gateway khỏi callback giả mạo
// Hàm chính:
// - verifyVnpaySignature(): kiểm tra HMAC-SHA512 theo chuẩn VNPay 2.1.0
// ========================
import crypto from 'crypto';
import { getVnpayConfig } from './vnpay.config';

// Phải khớp 100% với builder — cùng logic encode thì verify mới đúng
const phpUrlEncode = (value: string): string =>
  encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

export const verifyVnpaySignature = (payload: Record<string, unknown>): boolean => {
  const config = getVnpayConfig();
  const secureHash = String(payload.vnp_SecureHash || payload.secureHash || '');
  if (!secureHash) return false;

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!key.startsWith('vnp_')) continue;
    if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
    if (value === undefined || value === null || value === '') continue;
    params[key] = String(value);
  }

  const sortedKeys = Object.keys(params).sort();
  // Hash data: key=phpUrlEncode(value) — khớp với builder
  const hashData = sortedKeys
    .map((key) => `${key}=${phpUrlEncode(params[key])}`)
    .join('&');

  const computedHash = crypto
    .createHmac('sha512', config.hashSecret)
    .update(Buffer.from(hashData, 'utf-8'))
    .digest('hex');

  // toLowerCase() để an toàn — VNPay có thể trả về uppercase hoặc lowercase hex
  return computedHash.toLowerCase() === secureHash.toLowerCase();
};
