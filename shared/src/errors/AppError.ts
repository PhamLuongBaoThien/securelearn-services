// ========================
// AppError: Lớp lỗi tùy chỉnh cho toàn hệ thống
// Kế thừa từ Error, bổ sung statusCode và isOperational
// ========================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  /**
   * @param message - Thông báo lỗi (hiển thị cho client)
   * @param statusCode - HTTP status code (400, 401, 403, 404, 500...)
   * @param isOperational - true = lỗi nghiệp vụ (dự đoán được), false = lỗi hệ thống
   */
  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Giữ đúng prototype chain khi extend built-in class
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace (bỏ constructor ra khỏi trace)
    Error.captureStackTrace(this, this.constructor);
  }
}

// --- Các lỗi thường dùng (Factory) ---

/** 400 - Dữ liệu đầu vào không hợp lệ */
export class BadRequestError extends AppError {
  constructor(message = 'Dữ liệu không hợp lệ.') {
    super(message, 400);
  }
}

/** 401 - Chưa xác thực (chưa đăng nhập, token hết hạn) */
export class UnauthorizedError extends AppError {
  constructor(message = 'Bạn chưa đăng nhập hoặc phiên đã hết hạn.') {
    super(message, 401);
  }
}

/** 403 - Không có quyền truy cập */
export class ForbiddenError extends AppError {
  constructor(message = 'Bạn không có quyền thực hiện hành động này.') {
    super(message, 403);
  }
}

/** 404 - Không tìm thấy tài nguyên */
export class NotFoundError extends AppError {
  constructor(message = 'Tài nguyên không tồn tại.') {
    super(message, 404);
  }
}

/** 409 - Xung đột dữ liệu (ví dụ: email đã tồn tại) */
export class ConflictError extends AppError {
  constructor(message = 'Dữ liệu đã tồn tại.') {
    super(message, 409);
  }
}

/** 500 - Lỗi hệ thống không dự đoán được */
export class InternalError extends AppError {
  constructor(message = 'Lỗi hệ thống máy chủ.') {
    super(message, 500, false);
  }
}
