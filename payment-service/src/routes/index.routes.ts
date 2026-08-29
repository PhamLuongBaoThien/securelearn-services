import { Application } from 'express';
import paymentRoutes from './payment.routes';

const routes = (app: Application) => {
  // Mount toàn bộ API checkout, giao dịch, coupon, thuê bao, tài chính và webhook của Payment Service.
  app.use('/api/payments', paymentRoutes);
};

export default routes;
