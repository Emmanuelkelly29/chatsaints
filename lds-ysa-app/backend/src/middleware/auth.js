'use strict';
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      `SELECT id, full_name, phone_number, email, role, status,
              stake_id, district_id, mission_id, mission_president_mission_id,
              missionary_mode_active, profile_hidden, is_approved,
              fcm_token, apns_token
       FROM users WHERE id = $1 AND status != 'suspended'`,
      [decoded.userId]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'User not found or suspended' });
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    next(err);
  }
};

const requireApproved = (req, res, next) => {
  if (!req.user.is_approved) {
    return res.status(403).json({ error: 'Account pending approval by an existing leader.' });
  }
  next();
};

const requireActive = (req, res, next) => {
  if (req.user.status !== 'active') {
    return res.status(403).json({ error: 'Account is not active.' });
  }
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  // IT Support bypasses all role checks
  if (req.user.role === 'it_support') return next();
  // Case-insensitive role match
  const userRole = (req.user.role || '').toLowerCase();
  const allowed = roles.map(r => r.toLowerCase());
  if (!allowed.includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { authenticate, requireApproved, requireActive, requireRole };
