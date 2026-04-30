import { Application } from 'express';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';

const routes = (app: Application) => {
  app.use('/api/auth', authRoutes);
  app.use('/api/admin/auth', adminRoutes);
};

export default routes;
