import { Router } from 'express';
import policyController from '../controllers/policy.controller';

const router = Router();
router.get('/', policyController.listPublic);
router.get('/:slug', policyController.getPublicBySlug);

export default router;
