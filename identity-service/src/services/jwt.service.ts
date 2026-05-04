// ========================
// JWT Service: Quản lý toàn bộ logic sinh và xác minh Token
// Stateless — Không lưu token vào Database.
// Bảo mật bằng: chữ ký bí mật (secret) + HttpOnly Cookie.
// ========================
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

// ===== Sinh Access Token (ngắn hạn — 10 phút) =====
// Chứa fullName để các service đọc tên mà không cần gọi DB
const generalAccessToken = (payload: { id: string; role: string; fullName: string }) => {
  const access_token = jwt.sign(
    { ...payload, iss: 'securelearn' }, // iss claim để Kong JWT Plugin nhận diện
    process.env.ACCESS_TOKEN as string,
    { expiresIn: '10m' }
  );
  return access_token;
};

// ===== Sinh Refresh Token (dài hạn — 7 ngày) =====
// Chỉ chứa {id, role} — KHÔNG chứa fullName để tránh reset thời gian session khi đổi tên
const generalRefreshToken = (payload: { id: string; role: string }) => {
  const refresh_token = jwt.sign(
    { ...payload, iss: 'securelearn' },
    process.env.REFRESH_TOKEN as string,
    { expiresIn: '7d' }
  );
  return refresh_token;
};

// ===== Sinh Reset Password Token (15 phút) =====
const generalResetToken = (payload: { id: string; email: string }) => {
  const token = jwt.sign(
    { ...payload },
    process.env.ACCESS_TOKEN as string,
    { expiresIn: '15m' }
  );
  return token;
};

// ===== Xác minh Reset Token =====
const verifyResetToken = (token: string): Promise<{ status: string; message?: string; decoded?: any }> => {
  return new Promise((resolve, reject) => {
    try {
      jwt.verify(token, process.env.ACCESS_TOKEN as string, (err, decoded) => {
        if (err) {
          return resolve({
            status: 'ERR',
            message: 'Token hết hạn hoặc không hợp lệ',
          });
        }
        resolve({
          status: 'OK',
          decoded,
        });
      });
    } catch (error) {
      reject(error);
    }
  });
};

// ===== Xác minh Refresh Token — chỉ verify, trả về decoded payload =====
// Controller sẽ query DB lấy fullName mới nhất rồi mới gọi generalAccessToken
const refreshTokenJwtService = (token: string): Promise<{ status: string; message: string; decoded?: { id: string; role: string } }> => {
  return new Promise((resolve, reject) => {
    try {
      jwt.verify(token, process.env.REFRESH_TOKEN as string, (err, user: any) => {
        if (err) {
          return resolve({ status: 'ERR', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
        }
        resolve({
          status: 'OK',
          message: 'Token hợp lệ.',
          decoded: { id: user?.id, role: user?.role },
        });
      });
    } catch (error) {
      reject(error);
    }
  });
};

export {
  generalAccessToken,
  generalRefreshToken,
  generalResetToken,
  verifyResetToken,
  refreshTokenJwtService,
};
