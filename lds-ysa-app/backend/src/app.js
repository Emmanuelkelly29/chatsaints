'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

// ── Security & Middleware ──────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true });
app.use('/api/', limiter);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
app.use('/api/auth/', authLimiter);

// Static uploads
const uploadPath = process.env.LOCAL_UPLOAD_PATH || './uploads';
app.use('/uploads', express.static(path.resolve(uploadPath)));

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/admin',          require('./routes/admin'));
app.use('/api/e2ee',           require('./routes/e2ee'));
app.use('/api/geography',      require('./routes/geography'));
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/users',          require('./routes/users'));
app.use('/api/conversations',  require('./routes/conversations'));
app.use('/api/calls',          require('./routes/calls'));
app.use('/api/messages',       require('./routes/messages'));
app.use('/api/notifications',  require('./routes/notifications'));
app.use('/api/ysa-pool',       require('./routes/ysaPool'));
app.use('/api/missionary',     require('./routes/missionary'));
app.use('/api/leaders',        require('./routes/leaders'));
app.use('/api/scriptures',     require('./routes/scriptures'));
app.use('/api/statuses',       require('./routes/statuses'));
app.use('/api/groups',         require('./routes/groups'));
app.use('/api/video',          require('./routes/video'));
app.use('/api/messages/:id/reactions', require('./routes/reactions'));
app.use('/api/settings',       require('./routes/settings'));
app.use('/api/media',          require('./routes/media'));
app.use('/api/announcements',  require('./routes/announcements'));
app.use('/api/meetings',       require('./routes/meetings'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'ChatSaints', time: new Date() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
