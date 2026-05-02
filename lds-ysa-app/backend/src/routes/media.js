'use strict';
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.LOCAL_UPLOAD_PATH || './uploads'),
  filename: (req, file, cb) => {
    const mimeToExt = {
      'audio/webm': 'webm',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/aac': 'aac',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'video/webm': 'webm',
      'video/mp4': 'mp4',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
    };
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext) {
      const guessed = mimeToExt[(file.mimetype || '').toLowerCase()];
      if (guessed) ext = `.${guessed}`;
    }
    if (!ext && ['application/octet-stream', ''].includes((file.mimetype || '').toLowerCase())) {
      // Browser blob uploads from recorders can come without extension/mime details.
      ext = '.webm';
    }
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExt = new Set([
    'jpeg', 'jpg', 'png', 'gif',
    'mp4', 'mov', 'webm',
    'mp3', 'm4a', 'ogg', 'wav', 'aac', 'weba', 'opus',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip',
  ]);
  const allowedMime = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
  ]);

  const ext = path.extname(file.originalname || '').toLowerCase().slice(1);
  const mime = (file.mimetype || '').toLowerCase();
  const extensionAllowed = !!ext && allowedExt.has(ext);
  const mediaMimeAllowed = mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
  const docMimeAllowed = allowedMime.has(mime);
  const genericBlobAllowed = !ext && (mime === '' || mime === 'application/octet-stream');

  cb(null, extensionAllowed || mediaMimeAllowed || docMimeAllowed || genericBlobAllowed);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

// POST /api/media/upload
router.post('/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or file type not allowed' });
  const url = `/uploads/${req.file.filename}`;
  return res.json({
    url,
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
});

module.exports = router;
