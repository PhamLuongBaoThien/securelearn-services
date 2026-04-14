// ========================
// JWT Service: Quản lý toàn bộ logic sinh và xác minh Token
// Stateless — Không lưu token vào Database.
// Bảo mật bằng: chữ ký bí mật (secret) + HttpOnly Cookie.
// ========================
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

// ===== Sinh Access Token (ngắn hạn — 30 giây để test, production nên đặt 15m) =====
const generalAccessToken = (payload: { id: string; role: string }) => {
  const access_token = jwt.sign(
    { ...payload, iss: 'securelearn' }, // iss claim để Kong JWT Plugin nhận diện
    process.env.ACCESS_TOKEN as string,
    { expiresIn: '30s' }
  );
  return access_token;
};

// ===== Sinh Refresh Token (dài hạn — 365 ngày) =====
const generalRefreshToken = (payload: { id: string; role: string }) => {
  const refresh_token = jwt.sign(
    { ...payload, iss: 'securelearn' }, // iss claim để Kong JWT Plugin nhận diện
    process.env.REFRESH_TOKEN as string,
    { expiresIn: '365d' }
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

// ===== Refresh Token — Dùng refresh token cũ để cấp access token mới =====
const refreshTokenJwtService = (token: string): Promise<{ status: string; message: string; access_token?: string }> => {
  return new Promise((resolve, reject) => {
    try {
      jwt.verify(token, process.env.REFRESH_TOKEN as string, (err, user: any) => {
        if (err) {
          return resolve({ status: 'ERR', message: 'Token không hợp lệ hoặc đã hết hạn.' });
        }
        // Sinh access token mới từ thông tin user trong refresh token
        const access_token = generalAccessToken({
          id: user?.id,
          role: user?.role,
        });

        resolve({
          status: 'OK',
          message: 'Cấp lại access token thành công.',
          access_token,
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
