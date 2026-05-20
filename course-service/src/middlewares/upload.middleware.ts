import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';

const ALLOWED_THUMBNAIL_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'securelearn/course-thumbnails',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 1280, height: 720, crop: 'limit' }],
  } as any,
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_THUMBNAIL_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(Object.assign(new Error('Ảnh khóa học chỉ hỗ trợ JPG, PNG hoặc WebP.'), { status: 400 }));
  },
});

export default upload;
