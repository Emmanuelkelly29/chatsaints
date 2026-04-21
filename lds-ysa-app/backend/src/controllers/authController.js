'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { query } = require('../config/database');
const { requiresLeaderApproval } = require('../utils/accessControl');

const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// In-memory OTP store (keyed by email or phone) — replace with Redis in production
const _otpStore = new Map(); // key -> { otp, expires }

const _mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOtp = async (req, res) => {
  try {
    const { email, phone_number } = req.body;

    // Determine if it's email or phone OTP
    const isPhone = !!phone_number;
    const isEmail = !!email;

    if (!isPhone && !isEmail)
      return res.status(400).json({ error: 'email or phone_number is required' });

    let user;
    let storeKey;

    if (isPhone) {
      user = await query('SELECT id FROM users WHERE phone_number = $1', [phone_number]);
      if (!user.rows.length)
        return res.status(404).json({ error: 'No account found with that phone number' });
      storeKey = `phone:${phone_number}`;
    } else {
      if (!email.includes('@'))
        return res.status(400).json({ error: 'Valid email is required' });
      user = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (!user.rows.length)
        return res.status(404).json({ error: 'No account found with that email address' });
      storeKey = `email:${email.toLowerCase()}`;
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 min
    _otpStore.set(storeKey, { otp, expires });

    if (isPhone) {
      // For development: log OTP to console (replace with SMS provider in production)
      console.log(`[OTP] Phone ${phone_number}: ${otp}`);
      return res.json({ message: 'Verification code sent', dev_otp: process.env.NODE_ENV !== 'production' ? otp : undefined });
    } else {
      // Send email
      await _mailer.sendMail({
        from: `"ChatSaints" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'ChatSaints — Your verification code',
        text: `Your ChatSaints verification code is: ${otp}\n\nThis code expires in 10 minutes.`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#C9A84C">ChatSaints</h2>
          <p>Your verification code is:</p>
          <h1 style="letter-spacing:8px;color:#0A1628;background:#C9A84C;padding:16px;border-radius:8px;text-align:center">${otp}</h1>
          <p style="color:#666">This code expires in 10 minutes. Do not share it with anyone.</p>
        </div>`,
      });
      return res.json({ message: 'Verification code sent' });
    }
  } catch (err) {
    console.error('sendOtp error:', err);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { email, phone_number, otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'otp is required' });

    const isPhone = !!phone_number;
    const isEmail = !!email;
    if (!isPhone && !isEmail)
      return res.status(400).json({ error: 'email or phone_number is required' });

    const storeKey = isPhone ? `phone:${phone_number}` : `email:${email.toLowerCase()}`;

    const stored = _otpStore.get(storeKey);
    if (!stored) return res.status(401).json({ error: 'No verification code found. Please request a new one.' });
    if (Date.now() > stored.expires) {
      _otpStore.delete(storeKey);
      return res.status(401).json({ error: 'Verification code expired. Please request a new one.' });
    }
    if (stored.otp !== otp.trim())
      return res.status(401).json({ error: 'Invalid verification code' });

    _otpStore.delete(storeKey);

    let result;
    if (isPhone) {
      result = await query(
        `SELECT id,full_name,phone_number,email,role,status,is_approved,
                stake_id,mission_id,missionary_mode_active,profile_hidden
         FROM users WHERE phone_number = $1`, [phone_number]);
    } else {
      result = await query(
        `SELECT id,full_name,phone_number,email,role,status,is_approved,
                stake_id,mission_id,missionary_mode_active,profile_hidden
         FROM users WHERE email = $1`, [email.toLowerCase()]);
    }

    if (!result.rows.length) return res.status(401).json({ error: 'Account not found' });
    const user = result.rows[0];
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });

    await query('UPDATE users SET last_seen=NOW() WHERE id=$1', [user.id]);
    return res.json({ token: generateToken(user.id), user });
  } catch (err) {
    console.error('verifyOtp error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
};

const register = async (req, res) => {
  try {
    const { phone_number, full_name, date_of_birth, is_single = true,
            role = 'ysa_member',
            stake_id, stake_name, stake_country,
            district_id, district_name, district_country,
            email, password } = req.body;

    if (!phone_number || !full_name || !date_of_birth || !password)
      return res.status(400).json({ error: 'phone_number, full_name, date_of_birth and password are required' });

    const existing = await query('SELECT id FROM users WHERE phone_number = $1', [phone_number]);
    if (existing.rows.length) return res.status(409).json({ error: 'Phone number already registered' });

    // Resolve stake — leaders may provide a name (find-or-create), members provide an id
    let resolvedStakeId = stake_id || null;
    if (stake_name?.trim()) {
      const ex = await query('SELECT id FROM stakes WHERE name ILIKE $1', [stake_name.trim()]);
      if (ex.rows.length) {
        resolvedStakeId = ex.rows[0].id;
      } else {
        const cr = await query(
          'INSERT INTO stakes (id, name, country) VALUES ($1, $2, $3) RETURNING id',
          [uuidv4(), stake_name.trim(), stake_country?.trim() || null]);
        resolvedStakeId = cr.rows[0].id;
      }
    }

    // Resolve district similarly
    let resolvedDistrictId = district_id || null;
    if (district_name?.trim()) {
      const ex = await query('SELECT id FROM districts WHERE name ILIKE $1', [district_name.trim()]);
      if (ex.rows.length) {
        resolvedDistrictId = ex.rows[0].id;
      } else {
        const cr = await query(
          'INSERT INTO districts (id, name, country) VALUES ($1, $2, $3) RETURNING id',
          [uuidv4(), district_name.trim(), district_country?.trim() || null]);
        resolvedDistrictId = cr.rows[0].id;
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const needsApproval = requiresLeaderApproval(role);
    const isApproved = !needsApproval;

    const result = await query(
      `INSERT INTO users (id,phone_number,full_name,date_of_birth,is_single,role,
        stake_id,district_id,email,is_approved,status,password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
       RETURNING id,full_name,phone_number,role,status,is_approved`,
      [uuidv4(),phone_number,full_name,date_of_birth,is_single,role,
       resolvedStakeId,resolvedDistrictId,email||null,isApproved,passwordHash]
    );

    const user = result.rows[0];

    if (needsApproval)
      await query(`INSERT INTO leader_approvals (id,applicant_id,declared_role,status) VALUES ($1,$2,$3,'pending')`,
        [uuidv4(), user.id, role]);

    if (role === 'ysa_member' && resolvedStakeId)
      await query(`INSERT INTO stake_pool_members (id,user_id,stake_id,approved) VALUES ($1,$2,$3,false) ON CONFLICT DO NOTHING`,
        [uuidv4(), user.id, resolvedStakeId]);

    return res.status(201).json({
      message: needsApproval ? 'Account created. Awaiting leader approval.' : 'Account created successfully.',
      token: generateToken(user.id), user
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
};

const login = async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) return res.status(400).json({ error: 'phone_number and password required' });

    const result = await query(
      `SELECT id,full_name,phone_number,email,role,status,is_approved,
              stake_id,mission_id,missionary_mode_active,profile_hidden,password_hash
       FROM users WHERE phone_number = $1`, [phone_number]);

    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });

    const valid = await bcrypt.compare(password, user.password_hash || '');
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await query('UPDATE users SET last_seen=NOW() WHERE id=$1', [user.id]);
    const { password_hash, ...safeUser } = user;
    return res.json({ token: generateToken(user.id), user: safeUser });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
};

const updatePushToken = async (req, res) => {
  try {
    const { fcm_token, apns_token } = req.body;
    await query('UPDATE users SET fcm_token=$1,apns_token=$2 WHERE id=$3',
      [fcm_token||null, apns_token||null, req.user.id]);
    return res.json({ message: 'Push token updated' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

module.exports = { register, login, updatePushToken, sendOtp, verifyOtp };
