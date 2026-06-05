import { Router } from 'express';
import cartController from '../controllers/cart.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router();

router.use(extractUser, requireStudentOrInstructor);

router.get('/', cartController.getCart);
router.post('/items', cartController.addItem);
router.delete('/items/:courseId', cartController.removeItem);
router.post('/merge', cartController.mergeGuestCart);
router.delete('/', cartController.clearCart);

export default router;
