import fs from 'fs';
import path from 'path';
import multer from 'multer';

const TMP_DIR = path.resolve(process.cwd(), 'tmp-media', 'incoming');
fs.mkdirSync(TMP_DIR, { recursive: true });

export const upload = multer({ dest: TMP_DIR });
