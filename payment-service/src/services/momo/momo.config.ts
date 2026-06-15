// ========================
// MoMo Config
// Mục đích:
// - gom cấu hình MoMo vào một nơi để create/query/verifier dùng chung
// - đọc env một lần, tránh rải thông số MoMo khắp payment-service
// Hàm chính:
// - getMomoConfig(): trả về cấu hình MoMo đã chuẩn hóa
// ========================

export type MomoConfig = {
  apiUrl: string;
  queryUrl: string;
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  returnUrl: string;
  ipnUrl: string;
  lang: string;
  requestType: 'payWithMethod';
};

export const getMomoConfig = (): MomoConfig => {
  const apiUrl = process.env.MOMO_API_URL || 'https://test-payment.momo.vn/v2/gateway/api/create';
  const queryUrl = process.env.MOMO_QUERY_URL || 'https://test-payment.momo.vn/v2/gateway/api/query';
  const partnerCode = process.env.MOMO_PARTNER_CODE || '';
  const accessKey = process.env.MOMO_ACCESS_KEY || '';
  const secretKey = process.env.MOMO_SECRET_KEY || '';
  const returnUrl = process.env.MOMO_RETURN_URL || `${process.env.CLIENT_URL || 'http://localhost:5173'}/payment/momo-return`;
  const ipnUrl = process.env.MOMO_IPN_URL || '';
  const lang = process.env.MOMO_LANG || 'vi';
  const requestType = 'payWithMethod' as const;

  if (!partnerCode) {
    throw new Error('MOMO_PARTNER_CODE is not defined in environment variables');
  }
  if (!accessKey) {
    throw new Error('MOMO_ACCESS_KEY is not defined in environment variables');
  }
  if (!secretKey) {
    throw new Error('MOMO_SECRET_KEY is not defined in environment variables');
  }
  if (!returnUrl) {
    throw new Error('MOMO_RETURN_URL is not defined in environment variables');
  }
  if (!ipnUrl) {
    throw new Error('MOMO_IPN_URL is not defined in environment variables');
  }

  return {
    apiUrl,
    queryUrl,
    partnerCode,
    accessKey,
    secretKey,
    returnUrl,
    ipnUrl,
    lang,
    requestType,
  };
};
