import { Application } from 'express';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';

const routes = (app: Application) => {
  // Mount API đăng ký, đăng nhập, hồ sơ, phiên đăng nhập và khôi phục mật khẩu của người dùng.
  app.use('/api/auth', authRoutes);
  // Mount API xác thực admin, quản lý nhân sự, vai trò/quyền và khóa tài khoản người dùng.
  app.use('/api/admin/auth', adminRoutes);
};

export default routes;
