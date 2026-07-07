import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'securelearn/website',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'svg', 'ico'],
    resource_type: 'image',
  } as any,
});

export const websiteAssetUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Logo/Favicon chỉ hỗ trợ JPG, PNG, WebP, SVG hoặc ICO.'), { status: 400 }));
  },
});
