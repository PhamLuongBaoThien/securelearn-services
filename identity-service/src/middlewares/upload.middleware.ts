import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';

const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'securelearn/avatars', // Thư mục lưu trên Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }],
  } as any,
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AVATAR_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(Object.assign(new Error('Ảnh đại diện chỉ hỗ trợ JPG, PNG hoặc WebP.'), { status: 400 }));
  },
});

export default upload;
