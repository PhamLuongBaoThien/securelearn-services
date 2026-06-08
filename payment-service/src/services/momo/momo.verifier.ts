// ========================
// MoMo Signature Verifier
// Mục đích:
// - verify chữ ký cho redirect/IPN/query response của MoMo
// - bảo vệ payment-service khỏi callback giả mạo
// Hàm chính:
// - verifyMomoSignature(): kiểm tra Hmac_SHA256 theo chuẩn MoMo
// ========================
import { getMomoConfig } from './momo.config';
import { createMomoSignature } from './momo.builder';

export const verifyMomoSignature = (payload: Record<string, unknown>): boolean => {
  const signature = String(payload.signature || payload.sign || '');
  if (!signature) return false;

  const config = getMomoConfig();
  const data: Record<string, string> = {
    accessKey: config.accessKey,
    amount: String(payload.amount ?? ''),
    extraData: String(payload.extraData ?? ''),
    message: String(payload.message ?? ''),
    orderId: String(payload.orderId ?? payload.order_id ?? ''),
    orderInfo: String(payload.orderInfo ?? ''),
    orderType: String(payload.orderType ?? ''),
    partnerCode: String(payload.partnerCode ?? ''),
    payType: String(payload.payType ?? ''),
    requestId: String(payload.requestId ?? payload.request_id ?? ''),
    responseTime: String(payload.responseTime ?? payload.response_time ?? ''),
    resultCode: String(payload.resultCode ?? payload.result_code ?? ''),
    transId: String(payload.transId ?? payload.trans_id ?? ''),
  };

  const computed = createMomoSignature(data, config.secretKey, [
    'accessKey',
    'amount',
    'extraData',
    'message',
    'orderId',
    'orderInfo',
    'orderType',
    'partnerCode',
    'payType',
    'requestId',
    'responseTime',
    'resultCode',
    'transId',
  ]);
  return computed.toLowerCase() === signature.toLowerCase();
};
