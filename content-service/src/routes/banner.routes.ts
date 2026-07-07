import { Router } from 'express';
import bannerController from '../controllers/banner.controller';

const router = Router();
router.get('/', bannerController.listPublic);
export default router;
