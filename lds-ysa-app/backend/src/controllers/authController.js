'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { query } = require('../config/database');
const { requiresLeaderApproval } = require('../utils/accessControl');

function phoneVariants(phone) {
  const variants = new Set([phone]);
  if (phone.startsWith('+')) {
    const digits = phone.slice(1);
    for (const codeLen of [3, 2, 1]) {
      const local = digits.slice(codeLen);
      if (local.length >= 7) variants.add('0' + local);
    }
  } else if (phone.startsWith('0') && phone.length >= 10) {
    variants.add('+234' + phone.slice(1));
  }
  return [...variants];
}

function _normText(value) {
  return (value || '').toString().trim().replace(/\s+/g, ' ');
}

async function _resolveStakeId(stakeId, stakeName, stakeCountry) {
  if (stakeId) return stakeId;

  const name = _normText(stakeName);
  const country = _normText(stakeCountry);
  if (!name) return null;

  if (country) {
    const exact = await query(
      `SELECT id
       FROM stakes
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND LOWER(TRIM(COALESCE(country, ''))) = LOWER(TRIM($2))
       LIMIT 1`,
      [name, country]
    );
    if (exact.rows.length) return exact.rows[0].id;
  }

  const byName = await query(
    `SELECT id, country
     FROM stakes
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
    [name]
  );
  if (byName.rows.length === 1) {
    const existing = byName.rows[0];
    if (country && !existing.country) {
      await query('UPDATE stakes SET country = $1 WHERE id = $2', [country, existing.id]);
    }
    return existing.id;
  }

  const created = await query(
    'INSERT INTO stakes (id, name, country) VALUES ($1, $2, $3) RETURNING id',
    [uuidv4(), name, country || null]
  );
  return created.rows[0].id;
}

async function _resolveDistrictId(districtId, districtName, districtCountry) {
  if (districtId) return districtId;

  const name = _normText(districtName);
  const country = _normText(districtCountry);
  if (!name) return null;

  if (country) {
    const exact = await query(
      `SELECT id
       FROM districts
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND LOWER(TRIM(COALESCE(country, ''))) = LOWER(TRIM($2))
       LIMIT 1`,
      [name, country]
    );
    if (exact.rows.length) return exact.rows[0].id;
  }

  const byName = await query(
    `SELECT id, country
     FROM districts
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
    [name]
  );
  if (byName.rows.length === 1) {
    const existing = byName.rows[0];
    if (country && !existing.country) {
      await query('UPDATE districts SET country = $1 WHERE id = $2', [country, existing.id]);
    }
    return existing.id;
  }

  const created = await query(
    'INSERT INTO districts (id, name, country) VALUES ($1, $2, $3) RETURNING id',
    [uuidv4(), name, country || null]
  );
  return created.rows[0].id;
}

// JWT expires in 30 days
const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });

// In-memory OTP store — key format: "purpose:email"
const _otpStore = new Map();

const _smtpUrl = (process.env.SMTP_URL || '').trim();
const _smtpHost = (process.env.SMTP_HOST || '').trim();
const _smtpPort = parseInt(process.env.SMTP_PORT || '587');
const _smtpSecure = process.env.SMTP_SECURE === 'true';
const _smtpUser = (process.env.SMTP_USER || '').trim();
const _smtpPass = (process.env.SMTP_PASS || '').trim();
const _mailFrom = (process.env.MAIL_FROM || process.env.SMTP_FROM || '').trim();

const _mailer = nodemailer.createTransport(
  _smtpUrl
    ? _smtpUrl
    : {
        host: _smtpHost,
        port: _smtpPort,
        secure: _smtpSecure,
        auth: _smtpUser && _smtpPass ? { user: _smtpUser, pass: _smtpPass } : undefined,
      }
);

function _hasPlaceholderSmtpCredentials() {
  const user = _smtpUser.toLowerCase();
  const pass = _smtpPass.toLowerCase();
  const url = _smtpUrl.toLowerCase();

  // URL mode (works for any provider): smtp://user:pass@host:port or smtps://...
  if (url) {
    return url.includes('your-user') || url.includes('your-pass') || (!url.startsWith('smtp://') && !url.startsWith('smtps://'));
  }

  // Host mode (works for any provider with explicit settings)
  return (
    !_smtpHost ||
    !user ||
    !pass ||
    user.includes('your-email') ||
    pass.includes('your-app-password') ||
    pass.includes('change_me')
  );
}

let _smtpVerifyPromise;
async function _ensureMailerReady() {
  if (_hasPlaceholderSmtpCredentials()) {
    throw new Error('SMTP is not configured. Set SMTP_URL or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in backend/.env with real values.');
  }
  if (!_smtpVerifyPromise) {
    _smtpVerifyPromise = _mailer.verify();
  }
  await _smtpVerifyPromise;
}

// ─── Shared: send a styled OTP email ─────────────────────────────────────────
async function _sendOtpEmail(toEmail, otp, subject) {
  await _ensureMailerReady();
  await _mailer.sendMail({
    from: _mailFrom || `"ChatSaints" <${_smtpUser}>`,
    to: toEmail,
    subject: subject || 'ChatSaints — Your verification code',
    text: `Your ChatSaints code is: ${otp}\n\nExpires in 10 minutes.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#C9A84C">ChatSaints</h2>
      <p>Your verification code:</p>
      <h1 style="letter-spacing:8px;color:#0A1628;background:#C9A84C;padding:16px;border-radius:8px;text-align:center">${otp}</h1>
      <p style="color:#666">Expires in 10 minutes. Do not share it.</p>
    </div>`,
  });
}

// ─── Send login OTP (email or phone lookup) ───────────────────────────────────
const sendOtp = async (req, res) => {
  try {
    const { email, phone_number } = req.body;
    if (!email && !phone_number)
      return res.status(400).json({ error: 'email or phone_number is required' });

    let targetEmail;
    if (email) {
      if (!email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
      const r = await query('SELECT email FROM users WHERE email = $1', [email.toLowerCase()]);
      if (!r.rows.length) return res.status(404).json({ error: 'No account found with that email address' });
      targetEmail = email.toLowerCase();
    } else {
      const variants = phoneVariants(phone_number.trim());
      const r = await query('SELECT email FROM users WHERE phone_number = ANY($1)', [variants]);
      if (!r.rows.length) return res.status(404).json({ error: 'No account found with that phone number' });
      targetEmail = r.rows[0].email;
      if (!targetEmail) return res.status(400).json({ error: 'No email linked to this account. Contact support.' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    _otpStore.set(`otp:${targetEmail || phone_number}`, { otp, expires: Date.now() + 10 * 60 * 1000 });
    console.log(`[OTP] ${targetEmail || phone_number}: ${otp}`);
    if (targetEmail) {
      try {
        await _sendOtpEmail(targetEmail, otp);
      } catch (e) {
        _otpStore.delete(`otp:${targetEmail || phone_number}`);
        console.error('Email send failed:', e.message);
        return res.status(502).json({ error: `Failed to deliver email OTP: ${e.message}` });
      }
    }
    return res.json({
      message: targetEmail ? `Verification code sent to ${targetEmail}` : 'Verification code sent',
      dev_otp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (err) {
    console.error('sendOtp error:', err);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
};

// ─── Verify login OTP ─────────────────────────────────────────────────────────
const verifyOtp = async (req, res) => {
  try {
    const { email, phone_number, otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'otp is required' });
    if (!email && !phone_number) return res.status(400).json({ error: 'email or phone_number is required' });

    let lookupKey, result;
    if (email) {
      lookupKey = `otp:${email.toLowerCase()}`;
    } else {
      const variants = phoneVariants(phone_number.trim());
      const r = await query('SELECT email FROM users WHERE phone_number = ANY($1)', [variants]);
      lookupKey = `otp:${r.rows[0]?.email || phone_number}`;
    }

    const stored = _otpStore.get(lookupKey);
    if (!stored) return res.status(401).json({ error: 'No verification code found. Please request a new one.' });
    if (Date.now() > stored.expires) {
      _otpStore.delete(lookupKey);
      return res.status(401).json({ error: 'Verification code expired. Please request a new one.' });
    }
    if (stored.otp !== otp.trim()) return res.status(401).json({ error: 'Invalid verification code' });
    _otpStore.delete(lookupKey);

    if (email) {
      result = await query(
        `SELECT id,full_name,phone_number,email,role,status,is_approved,
                stake_id,mission_id,missionary_mode_active,profile_hidden
         FROM users WHERE email = $1`, [email.toLowerCase()]);
    } else {
      const variants = phoneVariants(phone_number.trim());
      result = await query(
        `SELECT id,full_name,phone_number,email,role,status,is_approved,
                stake_id,mission_id,missionary_mode_active,profile_hidden
         FROM users WHERE phone_number = ANY($1)`, [variants]);
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

// ─── Verify registration OTP → activate account ───────────────────────────────
const verifyRegistration = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });

    const storeKey = `reg:${email.toLowerCase()}`;
    const stored = _otpStore.get(storeKey);
    if (!stored) return res.status(401).json({ error: 'No registration code found. Please register again.' });
    if (Date.now() > stored.expires) {
      _otpStore.delete(storeKey);
      return res.status(401).json({ error: 'Registration code expired. Please register again.' });
    }
    if (stored.otp !== otp.trim()) return res.status(401).json({ error: 'Invalid code' });
    _otpStore.delete(storeKey);

    const result = await query(
      `UPDATE users SET email_verified = true, status = 'active'
       WHERE email = $1
       RETURNING id,full_name,phone_number,email,role,status,is_approved,
                 stake_id,mission_id,missionary_mode_active,profile_hidden`,
      [email.toLowerCase()]);

    if (!result.rows.length) return res.status(404).json({ error: 'Account not found' });
    const user = result.rows[0];
    await query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
    return res.json({ token: generateToken(user.id), user });
  } catch (err) {
    console.error('verifyRegistration error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
};

// ─── Send session-refresh OTP (30-day relogin) ────────────────────────────────
const sendSessionOtp = async (req, res) => {
  try {
    const { email, phone_number } = req.body;
    if (!email && !phone_number) return res.status(400).json({ error: 'email or phone_number required' });

    let userEmail;
    if (email) {
      const r = await query("SELECT email FROM users WHERE email = $1 AND status != 'suspended'", [email.toLowerCase()]);
      if (!r.rows.length) return res.status(404).json({ error: 'No account found with that email' });
      userEmail = email.toLowerCase();
    } else {
      const variants = phoneVariants(phone_number.trim());
      const r = await query('SELECT email FROM users WHERE phone_number = ANY($1)', [variants]);
      if (!r.rows.length) return res.status(404).json({ error: 'No account found' });
      userEmail = r.rows[0].email;
      if (!userEmail) return res.status(400).json({ error: 'No email linked to this account. Contact support.' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    _otpStore.set(`session:${userEmail}`, { otp, expires: Date.now() + 10 * 60 * 1000 });
    console.log(`[SESSION OTP] ${userEmail}: ${otp}`);
    try {
      await _sendOtpEmail(userEmail, otp, 'ChatSaints — Monthly Session Refresh Code');
    } catch (e) {
      _otpStore.delete(`session:${userEmail}`);
      console.error('Email send failed (session OTP):', e.message);
      return res.status(502).json({ error: `Failed to deliver email OTP: ${e.message}` });
    }

    return res.json({
      message: 'Session refresh code sent to your registered email',
      dev_otp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (err) {
    console.error('sendSessionOtp error:', err);
    return res.status(500).json({ error: 'Failed to send refresh code' });
  }
};

// ─── Verify session-refresh OTP ───────────────────────────────────────────────
const verifySessionOtp = async (req, res) => {
  try {
    const { email, phone_number, otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'otp required' });

    let userEmail;
    if (email) {
      userEmail = email.toLowerCase();
    } else if (phone_number) {
      const variants = phoneVariants(phone_number.trim());
      const r = await query('SELECT email FROM users WHERE phone_number = ANY($1)', [variants]);
      userEmail = r.rows[0]?.email;
    }
    if (!userEmail) return res.status(400).json({ error: 'email or phone_number required' });

    const storeKey = `session:${userEmail}`;
    const stored = _otpStore.get(storeKey);
    if (!stored) return res.status(401).json({ error: 'No refresh code found. Please request a new one.' });
    if (Date.now() > stored.expires) {
      _otpStore.delete(storeKey);
      return res.status(401).json({ error: 'Code expired. Please request a new one.' });
    }
    if (stored.otp !== otp.trim()) return res.status(401).json({ error: 'Invalid code' });
    _otpStore.delete(storeKey);

    const result = await query(
      `SELECT id,full_name,phone_number,email,role,status,is_approved,
              stake_id,mission_id,missionary_mode_active,profile_hidden
       FROM users WHERE email = $1 AND status != 'suspended'`, [userEmail]);
    if (!result.rows.length) return res.status(401).json({ error: 'Account not found or suspended' });

    const user = result.rows[0];
    await query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
    return res.json({ token: generateToken(user.id), user });
  } catch (err) {
    console.error('verifySessionOtp error:', err);
    return res.status(500).json({ error: 'Session refresh failed' });
  }
};

// ─── Register ─────────────────────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { phone_number, full_name, date_of_birth, is_single = true,
            role = 'ysa_member',
            stake_id, stake_name, stake_country,
            district_id, district_name, district_country,
            mission_id,
            email, password } = req.body;

        const normalizedStakeName = _normText(stake_name);
        const normalizedStakeCountry = _normText(stake_country);
        const normalizedDistrictName = _normText(district_name);
        const normalizedDistrictCountry = _normText(district_country);

    // Email is now REQUIRED
    if (!phone_number || !full_name || !date_of_birth || !password || !email)
      return res.status(400).json({ error: 'phone_number, full_name, date_of_birth, email and password are all required' });

    if (!email.includes('@')) return res.status(400).json({ error: 'A valid email address is required' });

    if (!phone_number.startsWith('+'))
      return res.status(400).json({ error: 'Phone number must include a country code (e.g. +234...)' });

    if (role === 'stake_presidency') {
      if (!normalizedStakeName) {
        return res.status(400).json({ error: 'Stake presidency registration requires stake_name' });
      }
      if (!normalizedStakeCountry) {
        return res.status(400).json({ error: 'Stake presidency registration requires stake_country' });
      }
    }

    if (role === 'missionary' && !mission_id) {
      return res.status(400).json({ error: 'Missionary registration requires mission_id' });
    }

    // Duplicate checks
    const variants = phoneVariants(phone_number.trim());
    const existingPhone = await query('SELECT id FROM users WHERE phone_number = ANY($1)', [variants]);
    if (existingPhone.rows.length) return res.status(409).json({ error: 'Phone number already registered' });

    const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingEmail.rows.length) return res.status(409).json({ error: 'Email address already registered' });

    // Resolve stake (dedupe + auto-merge by name/country)
    const resolvedStakeId = await _resolveStakeId(stake_id || null, normalizedStakeName, normalizedStakeCountry);

    // Resolve district (dedupe + auto-merge by name/country)
    const resolvedDistrictId = await _resolveDistrictId(district_id || null, normalizedDistrictName, normalizedDistrictCountry);

    const passwordHash = await bcrypt.hash(password, 12);
    const needsApproval = requiresLeaderApproval(role);
    const isApproved = !needsApproval;

    // Create user with email_verified=false; status set to active after OTP verified
    const result = await query(
      `INSERT INTO users (id,phone_number,full_name,date_of_birth,is_single,role,
        stake_id,district_id,mission_id,email,is_approved,status,password_hash,email_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_approval',$12,false)
       RETURNING id,full_name,phone_number,email,role,status,is_approved`,
      [uuidv4(), phone_number, full_name, date_of_birth, is_single, role,
       resolvedStakeId, resolvedDistrictId, mission_id || null, email.toLowerCase(), isApproved, passwordHash]
    );

    const user = result.rows[0];

    if (needsApproval)
      await query(`INSERT INTO leader_approvals (id,applicant_id,declared_role,status) VALUES ($1,$2,$3,'pending')`,
        [uuidv4(), user.id, role]);

    if (role === 'ysa_member' && resolvedStakeId)
      await query(`INSERT INTO stake_pool_members (id,user_id,stake_id,approved) VALUES ($1,$2,$3,false) ON CONFLICT DO NOTHING`,
        [uuidv4(), user.id, resolvedStakeId]);

    // Send 6-digit registration OTP to email
    const otp = crypto.randomInt(100000, 999999).toString();
    _otpStore.set(`reg:${email.toLowerCase()}`, { otp, expires: Date.now() + 10 * 60 * 1000 });
    console.log(`[REG OTP] ${email}: ${otp}`);
    try {
      await _sendOtpEmail(email, otp, 'ChatSaints — Verify Your Email to Complete Registration');
    } catch (mailErr) {
      _otpStore.delete(`reg:${email.toLowerCase()}`);
      console.error('Email send failed (registration OTP):', mailErr.message);
      return res.status(502).json({ error: `Failed to deliver registration OTP: ${mailErr.message}` });
    }

    return res.status(201).json({
      pending: true,
      email: email.toLowerCase(),
      message: 'A 6-digit verification code has been sent to your email. Enter it to complete registration.',
      dev_otp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
};

// ─── Login (email or phone + password, issues 30-day JWT) ─────────────────────
const login = async (req, res) => {
  try {
    const { phone_number, email, password } = req.body;
    if ((!phone_number && !email) || !password)
      return res.status(400).json({ error: 'phone_number or email, and password are required' });

    let result;
    if (email) {
      result = await query(
        `SELECT id,full_name,phone_number,email,role,status,is_approved,
                stake_id,mission_id,missionary_mode_active,profile_hidden,password_hash
         FROM users WHERE email = $1`, [email.toLowerCase()]);
    } else {
      const variants = phoneVariants(phone_number.trim());
      result = await query(
        `SELECT id,full_name,phone_number,email,role,status,is_approved,
                stake_id,mission_id,missionary_mode_active,profile_hidden,password_hash
         FROM users WHERE phone_number = ANY($1)`, [variants]);
    }

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

// ─── Update push token ────────────────────────────────────────────────────────
const updatePushToken = async (req, res) => {
  try {
    const { fcm_token, apns_token } = req.body;
    await query('UPDATE users SET fcm_token=$1,apns_token=$2 WHERE id=$3', [fcm_token || null, apns_token || null, req.user.id]);
    return res.json({ message: 'Push token updated' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

module.exports = {
  register, login, updatePushToken,
  sendOtp, verifyOtp,
  verifyRegistration,
  sendSessionOtp, verifySessionOtp,
};
