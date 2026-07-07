import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'securelearn/banners',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1920, height: 1080, crop: 'fill', gravity: 'auto', quality: 'auto' }],
  } as any,
});

export const bannerUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Ảnh banner chỉ hỗ trợ JPG, PNG hoặc WebP.'), { status: 400 }));
  },
});
