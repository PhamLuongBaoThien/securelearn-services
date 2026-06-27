/**
 * Chuẩn hoá dữ liệu định danh trước khi service kiểm tra và lưu vào cơ sở dữ liệu.
 * Email được cắt khoảng trắng, chuyển về chữ thường và kiểm tra định dạng.
 * Số điện thoại Việt Nam được đưa về dạng 0xxxxxxxxx để kiểm tra trùng nhất quán.
 */
export const normalizeEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Email không đúng định dạng.');
  return normalized;
};

export const normalizeVietnamPhone = (phone: string): string => {
  const compact = phone.replace(/[\s().-]/g, '');
  let normalized = compact;
  if (normalized.startsWith('+84')) normalized = `0${normalized.slice(3)}`;
  else if (normalized.startsWith('84')) normalized = `0${normalized.slice(2)}`;
  if (!/^0\d{9}$/.test(normalized)) throw new Error('Số điện thoại không hợp lệ. Vui lòng dùng số Việt Nam gồm 10 chữ số.');
  return normalized;
};
