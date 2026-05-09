import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'securelearn/course-thumbnails',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 1280, height: 720, crop: 'limit' }],
  } as any,
});

const upload = multer({ storage });

export default upload;
