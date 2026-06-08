// ========================
// MoMo Request Builder
// Mục đích:
// - build body request cho MoMo captureWallet/query
// - tạo chữ ký Hmac_SHA256 đúng chuẩn MoMo
// Hàm chính:
// - buildMomoCreatePayload()
// - buildMomoQueryPayload()
// - createMomoSignature()
// ========================
import crypto from 'crypto';
import { getMomoConfig } from './momo.config';

type Primitive = string | number | boolean | null | undefined | Record<string, unknown> | unknown[];

const buildSignatureData = (payload: Record<string, Primitive>, keys?: string[]): string => {
  const filtered = Object.entries(payload)
    .filter(([key, value]) => key !== 'signature' && key !== 'sign' && value !== undefined && value !== null);

  const ordered = (keys && keys.length > 0
    ? keys.filter((key) => payload[key] !== undefined && payload[key] !== null)
    : filtered.map(([key]) => key).sort());

  return ordered
    .map((key) => `${key}=${String(payload[key])}`)
    .join('&');
};

export const createMomoSignature = (payload: Record<string, Primitive>, secretKey: string, keys?: string[]): string => {
  const data = buildSignatureData(payload, keys);
  return crypto.createHmac('sha256', secretKey).update(Buffer.from(data, 'utf-8')).digest('hex');
};

export const buildMomoCreatePayload = (input: {
  partnerCode?: string;
  requestId: string;
  orderId: string;
  amount: number;
  orderInfo: string;
  redirectUrl: string;
  ipnUrl: string;
  extraData?: string;
  autoCapture?: boolean;
  lang?: string;
  orderExpireTime?: number;
  items?: Array<{
    id: string;
    name: string;
    description: string;
    imageUrl?: string;
    price: number;
    quantity: number;
    totalPrice: number;
    category?: string;
    unit?: string;
    taxAmount?: number;
  }>;
  userInfo?: {
    name: string;
    email?: string;
    phoneNumber?: string;
  };
}) => {
  const config = getMomoConfig();
  const payload: Record<string, Primitive> = {
    partnerCode: input.partnerCode || config.partnerCode,
    accessKey: config.accessKey,
    requestId: input.requestId,
    amount: Math.round(input.amount),
    orderId: input.orderId,
    orderInfo: input.orderInfo,
    redirectUrl: input.redirectUrl,
    ipnUrl: input.ipnUrl,
    requestType: config.requestType,
    extraData: input.extraData || '',
    autoCapture: typeof input.autoCapture === 'boolean' ? input.autoCapture : config.autoCapture,
    lang: input.lang || config.lang,
    orderExpireTime: input.orderExpireTime || config.orderExpireTime,
    items: input.items || [],
    userInfo: input.userInfo || {},
  };

  const signatureKeys = [
    'accessKey',
    'amount',
    'extraData',
    'ipnUrl',
    'orderId',
    'orderInfo',
    'partnerCode',
    'redirectUrl',
    'requestId',
    'requestType',
  ];

  return {
    partnerCode: String(payload.partnerCode),
    requestId: String(payload.requestId),
    amount: Number(payload.amount),
    orderId: String(payload.orderId),
    orderInfo: String(payload.orderInfo),
    redirectUrl: String(payload.redirectUrl),
    ipnUrl: String(payload.ipnUrl),
    requestType: String(payload.requestType),
    extraData: String(payload.extraData || ''),
    autoCapture: Boolean(payload.autoCapture),
    lang: String(payload.lang || config.lang),
    orderExpireTime: Number(payload.orderExpireTime || config.orderExpireTime),
    items: Array.isArray(payload.items) ? payload.items : [],
    userInfo: payload.userInfo || {},
    signature: createMomoSignature(payload, config.secretKey, signatureKeys),
  };
};

export const buildMomoQueryPayload = (input: {
  partnerCode?: string;
  requestId: string;
  orderId: string;
  lang?: string;
}) => {
  const config = getMomoConfig();
  const payload: Record<string, Primitive> = {
    partnerCode: input.partnerCode || config.partnerCode,
    accessKey: config.accessKey,
    requestId: input.requestId,
    orderId: input.orderId,
    lang: input.lang || config.lang,
  };

  const signatureKeys = ['accessKey', 'orderId', 'partnerCode', 'requestId'];

  return {
    partnerCode: String(payload.partnerCode),
    requestId: String(payload.requestId),
    orderId: String(payload.orderId),
    lang: String(payload.lang || config.lang),
    signature: createMomoSignature(payload, config.secretKey, signatureKeys),
  };
};
