'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate, requireActive } = require('../middleware/auth');
const { ROLE_TIER } = require('../utils/accessControl');

// GET /api/ysa-pool/members — list all pool members for leader's stake
router.get('/members', authenticate, requireActive, async (req, res, next) => {
  try {
    const allowed = ['ysa_rep','bishop','stake_presidency','it_support'];
    const isItSupport = req.user.role === 'it_support';
    if (!allowed.includes(req.user.role))
      return res.status(403).json({ error: 'Leaders only' });

    // IT Support sees all stakes; others see their own
    const stakeFilter = isItSupport ? '' : 'AND spm.stake_id = $1';
    const params = isItSupport ? [] : [req.user.stake_id];

    const result = await query(
      `SELECT spm.id, spm.user_id, spm.stake_id, spm.approved, spm.approved_at, spm.created_at,
              u.full_name, u.phone_number, u.email, u.profile_photo_url, u.role,
              s.name as stake_name,
              ab.full_name as added_by_name
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       LEFT JOIN stakes s ON spm.stake_id = s.id
       LEFT JOIN users ab ON spm.added_by = ab.id
       WHERE 1=1 ${stakeFilter}
       ORDER BY spm.approved ASC, spm.created_at DESC`,
      params
    );

    // Also get stake pool active status
    const stakeResult = isItSupport
      ? await query('SELECT id, name, ysa_pool_active FROM stakes ORDER BY name')
      : await query('SELECT id, name, ysa_pool_active FROM stakes WHERE id = $1', [req.user.stake_id]);

    // Get districts
    const districtResult = isItSupport
      ? await query('SELECT id, name, ysa_pool_active FROM districts ORDER BY name')
      : await query('SELECT id, name, ysa_pool_active FROM districts WHERE id = (SELECT district_id FROM users WHERE id = $1)', [req.user.id]);

    res.json({ data: result.rows, stakes: stakeResult.rows, districts: districtResult.rows });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/members/:id/approve — approve a pool member
router.post('/members/:id/approve', authenticate, requireActive, async (req, res, next) => {
  try {
    const allowed = ['ysa_rep','bishop','stake_presidency','it_support'];
    if (!allowed.includes(req.user.role))
      return res.status(403).json({ error: 'Leaders only' });

    await query(
      'UPDATE stake_pool_members SET approved=true, approved_at=NOW(), added_by=$1 WHERE id=$2',
      [req.user.id, req.params.id]
    );
    res.json({ message: 'Member approved' });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/members/:id/remove — remove a pool member
router.post('/members/:id/remove', authenticate, requireActive, async (req, res, next) => {
  try {
    const allowed = ['ysa_rep','bishop','stake_presidency','it_support'];
    if (!allowed.includes(req.user.role))
      return res.status(403).json({ error: 'Leaders only' });

    await query('DELETE FROM stake_pool_members WHERE id=$1', [req.params.id]);
    res.json({ message: 'Member removed' });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/toggle-district/:districtId — toggle district pool active status
router.post('/toggle-district/:districtId', authenticate, requireActive, async (req, res, next) => {
  try {
    if ((ROLE_TIER[req.user.role] || 0) < 4 && req.user.role !== 'it_support')
      return res.status(403).json({ error: 'Only mission presidents or above' });

    const result = await query(
      'UPDATE districts SET ysa_pool_active = NOT ysa_pool_active WHERE id = $1 RETURNING ysa_pool_active',
      [req.params.districtId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'District not found' });
    res.json({ active: result.rows[0].ysa_pool_active });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/toggle/:stakeId — toggle pool active status
router.post('/toggle/:stakeId', authenticate, requireActive, async (req, res, next) => {
  try {
    if ((ROLE_TIER[req.user.role] || 0) < 4 && req.user.role !== 'it_support')
      return res.status(403).json({ error: 'Only stake presidents or above' });

    const result = await query(
      'UPDATE stakes SET ysa_pool_active = NOT ysa_pool_active WHERE id = $1 RETURNING ysa_pool_active',
      [req.params.stakeId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Stake not found' });
    res.json({ active: result.rows[0].ysa_pool_active });
  } catch (err) { next(err); }
});

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

// GET /api/ysa-pool/my-status — check current user's pool membership status
router.get('/my-status', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!req.user.stake_id)
      return res.json({ status: 'no_stake' });

    const stakeCheck = await query(
      'SELECT ysa_pool_active FROM stakes WHERE id = $1',
      [req.user.stake_id]
    );
    const stakeOpen = stakeCheck.rows.length > 0 && stakeCheck.rows[0].ysa_pool_active;

    const member = await query(
      'SELECT id, approved, approved_at, created_at FROM stake_pool_members WHERE user_id = $1 AND stake_id = $2',
      [req.user.id, req.user.stake_id]
    );

    if (!member.rows.length) {
      return res.json({ status: 'not_requested', stake_open: stakeOpen });
    }

    const row = member.rows[0];
    return res.json({
      status: row.approved ? 'approved' : 'pending',
      stake_open: stakeOpen,
      member_id: row.id,
      requested_at: row.created_at,
      approved_at: row.approved_at,
    });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/request — YSA member self-nominates to join pool
router.post('/request', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!req.user.stake_id)
      return res.status(400).json({ error: 'You are not assigned to a stake' });

    const { v4: uuidv4local } = require('uuid');
    const result = await query(
      `INSERT INTO stake_pool_members (id, user_id, stake_id, added_by, approved)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (user_id, stake_id) DO NOTHING
       RETURNING *`,
      [uuidv4(), req.user.id, req.user.stake_id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(409).json({ error: 'Already requested' });
    }
    res.status(201).json({ message: 'Request submitted. Awaiting leader approval.' });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/discover — discover YSA from other open pools (grouped by country/continent)
router.get('/discover', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!req.user.stake_id)
      return res.status(403).json({ error: 'You are not assigned to a stake' });

    // Check that user's own stake pool is open
    const stakeCheck = await query(
      'SELECT ysa_pool_active FROM stakes WHERE id = $1',
      [req.user.stake_id]
    );
    if (!stakeCheck.rows.length || !stakeCheck.rows[0].ysa_pool_active)
      return res.status(403).json({ error: 'Your stake pool must be open first' });

    // Check user is approved in the pool
    const selfCheck = await query(
      'SELECT id FROM stake_pool_members WHERE user_id = $1 AND stake_id = $2 AND approved = true',
      [req.user.id, req.user.stake_id]
    );
    if (!selfCheck.rows.length)
      return res.status(403).json({ error: 'You must be an approved pool member to browse' });

    // Find all approved members in other open stakes, with country & continent
    const contacts = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role,
              s.name AS stake_name, s.country,
              a.continent, a.name AS area_name
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       JOIN stakes s ON spm.stake_id = s.id
       LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       LEFT JOIN areas a ON cc.area_id = a.id
       WHERE s.ysa_pool_active = true
         AND spm.stake_id != $1
         AND spm.approved = true
         AND u.status = 'active'
         AND u.profile_hidden = false
       ORDER BY a.continent NULLS LAST, s.country, u.full_name`,
      [req.user.stake_id]
    );
    res.json({ contacts: contacts.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/global — missionaries browse worldwide approved pool members (read-only)
router.get('/global', authenticate, requireActive, async (req, res, next) => {
  try {
    const contacts = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role,
              s.name AS stake_name, s.country,
              a.continent, a.name AS area_name
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       JOIN stakes s ON spm.stake_id = s.id
       LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       LEFT JOIN areas a ON cc.area_id = a.id
       WHERE s.ysa_pool_active = true
         AND spm.approved = true
         AND u.status = 'active'
         AND u.profile_hidden = false
       ORDER BY a.continent NULLS LAST, s.country, u.full_name`,
      []
    );
    res.json({ contacts: contacts.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/my-stake — all approved YSA pool members in the caller's stake
// Any authenticated user with a stake_id can see their stake's pool
router.get('/my-stake', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!req.user.stake_id)
      return res.status(200).json({ members: [], myStatus: 'no_stake', stake: null });

    // Get stake info
    const stakeRes = await query(
      'SELECT id, name, country, ysa_pool_active FROM stakes WHERE id = $1',
      [req.user.stake_id]
    );
    const stake = stakeRes.rows[0] || null;

    // Get caller's own pool status
    const selfRes = await query(
      'SELECT approved FROM stake_pool_members WHERE user_id = $1 AND stake_id = $2',
      [req.user.id, req.user.stake_id]
    );
    const myStatus = selfRes.rows.length
      ? (selfRes.rows[0].approved ? 'approved' : 'pending')
      : 'not_in_pool';

    // Get all approved members in this stake
    const membersRes = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role,
              spm.approved_at,
              u.status
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       WHERE spm.stake_id = $1
         AND spm.approved = true
         AND u.status = 'active'
       ORDER BY u.full_name`,
      [req.user.stake_id]
    );

    res.json({ members: membersRes.rows, myStatus, stake });
  } catch (err) { next(err); }
});

module.exports = router;

