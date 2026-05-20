import fs from 'fs';
import path from 'path';
import multer from 'multer';

const TMP_DIR = path.resolve(process.cwd(), 'tmp-media', 'incoming');
fs.mkdirSync(TMP_DIR, { recursive: true });

const BLOCKED_DOCUMENT_EXTENSIONS = new Set([
  '.bat',
  '.cmd',
  '.com',
  '.dll',
  '.exe',
  '.htm',
  '.html',
  '.jar',
  '.js',
  '.lnk',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
  '.svg',
  '.vbs',
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

const isBlockedDocument = (file: Express.Multer.File) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  return BLOCKED_DOCUMENT_EXTENSIONS.has(extension) || BLOCKED_DOCUMENT_MIME_TYPES.has(mimeType);
};

// Upload document: giới hạn 50MB
export const uploadDocument = multer({
  dest: TMP_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isBlockedDocument(file)) {
      cb(Object.assign(new Error('Định dạng tài liệu này không được hỗ trợ vì lý do bảo mật.'), { status: 400 }));
      return;
    }

    cb(null, true);
  },
});
