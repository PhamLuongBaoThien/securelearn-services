import { Application } from 'express';
import progressRoutes from './progress.routes';

const routes = (app: Application) => {
  app.use('/api/progress', progressRoutes);
};

export default routes;
