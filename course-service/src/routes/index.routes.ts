import { Application } from 'express';
import courseRoutes from './course.routes';

const routes = (app: Application) => {
  app.use('/api/courses', courseRoutes);
};

export default routes;
