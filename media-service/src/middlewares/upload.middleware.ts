import fs from 'fs';
import path from 'path';
import multer from 'multer';

const TMP_DIR = path.resolve(process.cwd(), 'tmp-media', 'incoming');
fs.mkdirSync(TMP_DIR, { recursive: true });

const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.txt',
  '.zip',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
]);

const BLOCKED_DOCUMENT_MIME_TYPES = new Set([
  'application/javascript',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-ms-installer',
  'application/x-sh',
  'application/x-shellscript',
  'image/svg+xml',
  'text/html',
  'text/javascript',
]);

const isAllowedDocument = (file: Express.Multer.File) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();
  return ALLOWED_DOCUMENT_EXTENSIONS.has(extension) && !BLOCKED_DOCUMENT_MIME_TYPES.has(mimeType);
};

// Upload document: giới hạn 50MB
export const uploadDocument = multer({
  dest: TMP_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedDocument(file)) {
      cb(Object.assign(new Error('Chỉ hỗ trợ PDF, Word, PowerPoint, Excel, TXT, ZIP và hình ảnh.'), { status: 400 }));
      return;
    }

    cb(null, true);
  },
});
