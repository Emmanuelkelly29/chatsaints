'use strict';
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const UPLOAD_DIR = process.env.LOCAL_UPLOAD_PATH || './uploads';

// Ensure upload dirs exist
['images','videos','audio','files','avatars'].forEach(dir => {
  fs.mkdirSync(`${UPLOAD_DIR}/${dir}`, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const mime = file.mimetype;
    let folder = 'files';
    if (mime.startsWith('image/')) folder = 'images';
    else if (mime.startsWith('video/')) folder = 'videos';
    else if (mime.startsWith('audio/')) folder = 'audio';
    cb(null, `${UPLOAD_DIR}/${folder}`);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/quicktime','video/webm',
    'audio/mpeg','audio/ogg','audio/wav','audio/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error(`File type ${file.mimetype} not allowed`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

const getFileUrl = (req, filePath) => {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/${filePath.replace(/\\/g, '/')}`;
};

module.exports = { upload, getFileUrl };
