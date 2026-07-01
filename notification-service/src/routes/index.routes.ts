import { Application, Router } from 'express';
import notificationController from '../controllers/notification.controller';
import adminController from '../controllers/admin.controller';
import { extractUser, requireAdmin } from '../middlewares/auth.middleware';
export default (app: Application) => {
  const user = Router(); user.use(extractUser);
  user.get('/', notificationController.list); user.get('/recent', notificationController.recent); user.get('/unread-count', notificationController.unreadCount);
  user.get('/preferences', notificationController.getPreferences); user.get('/channel-capabilities', notificationController.getCapabilities); user.put('/preferences', notificationController.updatePreferences);
  user.patch('/read-all', notificationController.markAllRead); user.patch('/:id/read', notificationController.markRead);
  app.use('/api/notifications', user);
  const admin = Router(); admin.use(extractUser, requireAdmin);
  admin.get('/templates', adminController.listTemplates); admin.post('/templates', adminController.createTemplate); admin.put('/templates/:id', adminController.updateTemplate); admin.delete('/templates/:id', adminController.deleteTemplate);
  admin.post('/campaigns', adminController.createCampaign); admin.get('/campaigns', adminController.listCampaigns); admin.get('/campaigns/:id', adminController.getCampaign); admin.post('/campaigns/:id/retry', adminController.retryCampaign);
  app.use('/api/admin/notifications', admin);
};