import { Router } from 'express';
import wishlistController from '../controllers/wishlist.controller';
import { extractUser, requireStudentOrInstructor } from '../middlewares/auth.middleware';

const router = Router();

router.use(extractUser, requireStudentOrInstructor);

router.get('/', wishlistController.getWishlist);
router.post('/items', wishlistController.addItem);
router.delete('/items/:courseId', wishlistController.removeItem);
router.post('/merge', wishlistController.mergeGuestWishlist);
router.delete('/', wishlistController.clearWishlist);

export default router;
