import { Application } from 'express';
import progressRoutes from './progress.routes';

const routes = (app: Application) => {
  // Mount API phiên học, heartbeat, tiến độ, quyền mở bài và analytics của Progress Service.
  app.use('/api/progress', progressRoutes);
};

export default routes;
