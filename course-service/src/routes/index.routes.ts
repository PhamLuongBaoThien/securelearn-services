import { Application } from 'express';
import courseRoutes from './course.routes';
import categoryRoutes from './category.routes';

const routes = (app: Application) => {
  app.use('/api/courses', courseRoutes);
  app.use('/api/categories', categoryRoutes);
};

export default routes;
