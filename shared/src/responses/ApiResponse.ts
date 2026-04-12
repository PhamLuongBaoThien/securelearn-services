// ========================
// ApiResponse: Chuẩn hóa format response cho toàn hệ thống
// Mọi service đều trả về cùng cấu trúc JSON
// ========================

export interface IApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

/**
 * Helper tạo response thành công.
 * 
 * @example
 * res.status(200).json(ApiResponse.success('Đăng nhập thành công.', { user, token }));
 */
export class ApiResponse {
  static success<T>(message: string, data?: T): IApiResponse<T> {
    return {
      success: true,
      message,
      data,
    };
  }

  /**
   * Helper tạo response lỗi.
   *
   * @example
   * res.status(400).json(ApiResponse.error('Email không hợp lệ.'));
   */
  static error(message: string, error?: string): IApiResponse {
    return {
      success: false,
      message,
      error,
    };
  }
}
