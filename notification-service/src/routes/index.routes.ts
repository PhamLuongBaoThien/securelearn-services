import { Application, Router } from 'express';
import notificationController from '../controllers/notification.controller';
import adminController from '../controllers/admin.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';

export default (app: Application) => {
  const user = Router();
  user.use(extractUser);
  user.get('/', notificationController.list);
  user.get('/recent', notificationController.recent);
  user.get('/unread-count', notificationController.unreadCount);
  user.get('/preferences', notificationController.getPreferences);
  user.get('/channel-capabilities', notificationController.getCapabilities);
  user.put('/preferences', notificationController.updatePreferences);
  user.patch('/read-all', notificationController.markAllRead);
  user.patch('/read-by-url', notificationController.markReadByUrl);
  user.patch('/:id/read', notificationController.markRead);
  app.use('/api/notifications', user);

  const admin = Router();
  admin.use(extractUser, requireAdmin);
  admin.get('/templates', requirePermission('notif:read'), adminController.listTemplates);
  admin.post('/templates', requirePermission('notif:manage'), adminController.createTemplate);
  admin.put('/templates/:id', requirePermission('notif:manage'), adminController.updateTemplate);
  admin.delete('/templates/:id', requirePermission('notif:manage'), adminController.deleteTemplate);
  admin.post('/campaigns', requirePermission('notif:manage'), adminController.createCampaign);
  admin.get('/campaigns', requirePermission('notif:read'), adminController.listCampaigns);
  admin.get('/campaigns/:id', requirePermission('notif:read'), adminController.getCampaign);
  admin.post('/campaigns/:id/retry', requirePermission('notif:manage'), adminController.retryCampaign);
  app.use('/api/admin/notifications', admin);
};
