import multer from 'multer';
export const uploadAttachments=multer({storage:multer.memoryStorage(),limits:{files:5,fileSize:10*1024*1024}}).array('files',5);
