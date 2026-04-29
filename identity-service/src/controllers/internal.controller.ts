// ========================
// Internal Controller: Endpoint nội bộ giữa các Microservice
// KHÔNG expose qua Kong API Gateway — chỉ dùng trong mạng Docker nội bộ
// ========================
import { Request, Response } from 'express';
import { User } from '../models/user.model';

class InternalController {
  /**
   * [GET] /internal/users/:userId/name
   * Trả về tên hiển thị (fullName) của user theo ID.
   * Dùng riêng cho các service nội bộ (ví dụ: course-service lấy tên giảng viên khi tạo khóa học).
   */
  public async getUserName(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const user = await User.findById(userId).select('fullName').lean();

      if (!user) {
        res.status(404).json({ status: 'ERR', message: 'Không tìm thấy người dùng.' });
        return;
      }

      res.status(200).json({
        status: 'OK',
        data: {
          userId,
          fullName: user.fullName,
        },
      });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new InternalController();
