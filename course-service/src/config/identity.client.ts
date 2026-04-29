// ========================
// Identity Client: Helper gọi Internal API của Identity Service
// Dùng trong course-service để lấy thông tin user mà không qua Kong
// ========================

const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || 'http://localhost:5001';

/**
 * Lấy tên hiển thị (fullName) của một instructor theo userId.
 * Gọi Internal API của identity-service — không qua Kong, không cần JWT.
 *
 * @param userId - ID của giảng viên cần lấy tên
 * @returns fullName nếu thành công, chuỗi rỗng '' nếu có lỗi (để không làm rớt request tạo khóa học)
 */
export const getInstructorName = async (userId: string): Promise<string> => {
  try {
    const response = await fetch(`${IDENTITY_SERVICE_URL}/internal/users/${userId}/name`);

    if (!response.ok) {
      console.warn(`[IdentityClient] Không tìm thấy tên cho userId: ${userId} (status: ${response.status})`);
      return '';
    }

    const data = await response.json() as { status: string; data: { fullName: string } };

    return data?.data?.fullName ?? '';
  } catch (error) {
    // Không throw error — service có thể tạm thời không kết nối được
    // Khóa học vẫn được tạo, tên sẽ được đồng bộ sau qua RabbitMQ
    console.error(`[IdentityClient] Lỗi khi lấy tên instructor ${userId}:`, error);
    return '';
  }
};
