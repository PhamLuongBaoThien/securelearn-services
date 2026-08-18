// ========================
// MoMo Client
// Mục đích:
// - gọi API create/query của MoMo sandbox hoặc production
// - bọc tạo giao dịch và truy vấn trạng thái MoMo
// Hàm chính:
// - createMomoPaymentSession()
// - queryMomoTransaction()
// ========================
import { getMomoConfig } from './momo.config';
import { buildMomoCreatePayload, buildMomoQueryPayload } from './momo.builder';

export type MomoCreateSessionInput = {
  requestId?: string;
  orderId: string;
  amount: number;
  orderInfo: string;
  redirectUrl: string;
  ipnUrl: string;
  extraData?: string;
  lang?: string;
  orderExpireTime?: number;
};

export type MomoCreateResponse = {
  partnerCode?: string;
  orderId?: string;
  requestId?: string;
  amount?: number;
  responseTime?: number;
  message?: string;
  resultCode?: number;
  payUrl?: string;
  deeplink?: string;
  qrCodeUrl?: string;
  transId?: number;
  signature?: string;
  [key: string]: unknown;
};

export type MomoQueryResponse = {
  partnerCode?: string;
  requestId?: string;
  orderId?: string;
  extraData?: string;
  amount?: number;
  transId?: number;
  payType?: string;
  resultCode?: number;
  refundTrans?: unknown[];
  message?: string;
  responseTime?: number;
  paymentOption?: string;
  promotionInfo?: unknown[];
  signature?: string;
  [key: string]: unknown;
};

const postJson = async <T>(url: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let data: T;

  try {
    data = JSON.parse(raw) as T;
  } catch {
    throw new Error(`MoMo API trả về dữ liệu không hợp lệ: ${raw}`);
  }

  if (!response.ok) {
    const maybeMessage = typeof data === 'object' && data !== null && 'message' in data ? String((data as Record<string, unknown>).message || '') : '';
    throw new Error(maybeMessage || `MoMo API trả về lỗi HTTP ${response.status}.`);
  }

  return data;
};

export const createMomoPaymentSession = async (input: MomoCreateSessionInput): Promise<MomoCreateResponse> => {
  const config = getMomoConfig();
  const requestId = input.requestId || `${input.orderId}${Date.now()}`;
  const request = buildMomoCreatePayload({
    requestId,
    orderId: input.orderId,
    amount: input.amount,
    orderInfo: input.orderInfo,
    redirectUrl: input.redirectUrl,
    ipnUrl: input.ipnUrl,
    extraData: input.extraData || '',
    lang: input.lang,
    orderExpireTime: input.orderExpireTime || config.orderExpireTime,
  });
  const response = await postJson<MomoCreateResponse>(config.apiUrl, request);

  if ((response.resultCode ?? 0) !== 0 || !response.payUrl) {
    throw new Error(response.message || 'Không thể tạo phiên thanh toán MoMo.');
  }

  return response;
};

export const queryMomoTransaction = async (orderId: string, lang?: string): Promise<MomoQueryResponse> => {
  const config = getMomoConfig();
  const request = buildMomoQueryPayload({
    requestId: `${orderId}${Date.now()}`,
    orderId,
    lang,
  });

  const response = await postJson<MomoQueryResponse>(config.queryUrl, request);

  if ((response.resultCode ?? -1) < 0) {
    throw new Error(response.message || 'Không thể truy vấn trạng thái giao dịch MoMo.');
  }

  return response;
};
