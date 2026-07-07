import { Router } from 'express';
import websiteConfigController from '../controllers/websiteConfig.controller';

const router = Router();
router.get('/', websiteConfigController.get);
export default router;
