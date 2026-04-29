import { Application } from 'express';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import internalRoutes from './internal.routes';

const routes = (app: Application) => {
  app.use('/api/auth', authRoutes);
  app.use('/api/admin/auth', adminRoutes);

  // Internal routes — chỉ dùng cho giao tiếp giữa các Microservice (không qua Kong)
  app.use('/internal', internalRoutes);
};

export default routes;
