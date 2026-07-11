import { Router } from 'express';
import policyController from '../controllers/policy.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';

const router = Router();
router.use(extractUser, requireAdmin, requirePermission('system:config'));
router.get('/', policyController.listAdmin);
router.post('/', policyController.create);
router.put('/:id', policyController.update);
router.patch('/:id/status', policyController.setStatus);
router.delete('/:id', policyController.delete);

export default router;
