import fs from 'fs';
import path from 'path';
import multer from 'multer';

const TMP_DIR = path.resolve(process.cwd(), 'tmp-media', 'incoming');
fs.mkdirSync(TMP_DIR, { recursive: true });

// Upload video: giới hạn 500MB
export const uploadVideo = multer({
  dest: TMP_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
});

// Upload document: giới hạn 50MB
export const uploadDocument = multer({
  dest: TMP_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});
