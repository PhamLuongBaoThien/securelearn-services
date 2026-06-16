// File này là điểm mount route cấp app của course-service.
// Ghi nhớ:
// - /api/courses chứa cả course routes và quiz attempt routes
// - /api/categories đi riêng vì vừa phục vụ admin vừa phục vụ course editor
import { Application } from 'express';
import courseRoutes from './course.routes';
import categoryRoutes from './category.routes';
import quizAttemptRoutes from './quizAttempt.routes';
import adminCourseRoutes from './adminCourse.routes';
import cartRoutes from './cart.routes';

const routes = (app: Application) => {
  // Admin review APIs phải mount riêng để không bị slug route của /api/courses bắt nhầm.
  app.use('/api/admin/courses', adminCourseRoutes);

  // Route này xử lý quiz attempt cho student.
  // Đặt trước courseRoutes để không bị các nested route (route "lồng nhau") quản lý của instructor chặn nhầm.
  app.use('/api/courses', quizAttemptRoutes);

  // Route này xử lý cả public course routes và authenticated course routes
  app.use('/api/courses', courseRoutes);

  // Route giỏ hàng cho learner đã đăng nhập
  app.use('/api/cart', cartRoutes);

  // Route cho category
  app.use('/api/categories', categoryRoutes);
};

export default routes;
