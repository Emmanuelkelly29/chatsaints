'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate, requireActive } = require('../middleware/auth');
const { ROLE_TIER } = require('../utils/accessControl');

// POST /api/ysa-pool/add — YSA Rep adds a member to pool
router.post('/add', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!['ysa_rep', 'stake_presidency', 'bishop'].includes(req.user.role))
      return res.status(403).json({ error: 'Only YSA reps can manage the pool' });

    const { userId, stakeId } = req.body;
    if (!userId || !stakeId) return res.status(400).json({ error: 'userId and stakeId are required' });

    const result = await query(
      `INSERT INTO stake_pool_members (id, user_id, stake_id, added_by, approved)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (user_id, stake_id) DO NOTHING
       RETURNING *`,
      [uuidv4(), userId, stakeId, req.user.id]
    );
    res.status(201).json({ member: result.rows[0] || null });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/open/:stakeId — open a stake pool for cross-stake visibility
router.post('/open/:stakeId', authenticate, requireActive, async (req, res, next) => {
  try {
    if ((ROLE_TIER[req.user.role] || 0) < 4)
      return res.status(403).json({ error: 'Only stake presidents can open the pool' });

    const result = await query(
      `UPDATE stakes SET ysa_pool_active = true WHERE id = $1 RETURNING *`,
      [req.params.stakeId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Stake not found' });
    res.json({ stake: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/discover — discover YSA from other open pools
router.get('/discover', authenticate, requireActive, async (req, res, next) => {
  try {
    if (req.user.role !== 'ysa_member' && (ROLE_TIER[req.user.role] || 0) < 2)
      return res.status(403).json({ error: 'YSA members only' });

    if (!req.user.stake_id)
      return res.status(403).json({ error: 'You are not assigned to a stake' });

    // Check that user's own stake pool is open
    const stakeCheck = await query(
      'SELECT ysa_pool_active FROM stakes WHERE id = $1',
      [req.user.stake_id]
    );
    if (!stakeCheck.rows.length || !stakeCheck.rows[0].ysa_pool_active)
      return res.status(403).json({ error: 'Your stake pool must be open first' });

    // Find all approved members in other open stakes
    const contacts = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, spm.stake_id
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       JOIN stakes s ON spm.stake_id = s.id
       WHERE s.ysa_pool_active = true
         AND spm.stake_id != $1
         AND spm.approved = true
         AND u.status = 'active'
         AND u.profile_hidden = false`,
      [req.user.stake_id]
    );
    res.json({ contacts: contacts.rows });
  } catch (err) { next(err); }
});

module.exports = router;

