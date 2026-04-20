'use strict';
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireApproved } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.LOCAL_UPLOAD_PATH || './uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|mp4|mov|mp3|m4a|ogg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip/;
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  cb(null, allowed.test(ext));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

// POST /api/media/upload
router.post('/upload', authenticate, requireApproved, upload.single('file'), (req, res) => {
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
