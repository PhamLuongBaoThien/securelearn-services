import { Application } from 'express';
import paymentRoutes from './payment.routes';

const routes = (app: Application) => {
  app.use('/api/payments', paymentRoutes);
};

export default routes;
