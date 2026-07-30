'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { broadcast } = require('../websocket/wsServer');

// ── Who can send announcements? ─────────────────────────────────
const LEADER_ROLES = new Set([
  'bishop', 'stake_presidency', 'district_presidency',
  'coordinating_council', 'area_authority', 'mission_president',
  'mission_president_wife', 'area_presidency', 'general_authority',
  'apostle', 'first_presidency', 'ysa_rep', 'ysa_adviser',
  'it_support',
]);

// Determine the scope + scope_id for the sender's role
const getSenderScope = (user) => {
  const role = user.role;
  // Global senders
  if (['apostle', 'first_presidency', 'general_authority',
       'area_presidency', 'it_support'].includes(role)) {
    return { scope: 'global', scope_id: null };
  }
  if (['area_authority', 'coordinating_council'].includes(role)) {
    // Uses their stake's area — approximate: send to all in their stake for now
    return { scope: 'stake', scope_id: user.stake_id };
  }
  if (role === 'mission_president' || role === 'mission_president_wife') {
    const missionId = user.mission_president_mission_id || user.mission_id;
    return { scope: 'mission', scope_id: missionId };
  }
  if (['bishop', 'stake_presidency', 'ysa_rep', 'ysa_adviser'].includes(role)) {
    return { scope: 'stake', scope_id: user.stake_id };
  }
  if (role === 'district_presidency') {
    return { scope: 'district', scope_id: user.district_id };
  }
  return null; // not allowed
};

// ── Audience helpers ────────────────────────────────────────────
// Ensure audience column exists (idempotent on startup)
query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience TEXT DEFAULT '["all"]'`)
  .catch(() => {});

// Maps audience key → which roles receive it
const AUDIENCE_ROLE_MAP = {
  ysa_only:                 ['ysa_member'],
  missionaries_only:        ['missionary'],
  ysa_and_missionaries:     ['ysa_member', 'missionary'],
  ward_leaders:             ['bishop', 'ysa_rep', 'ysa_adviser'],
  stake_district_presidents:['stake_presidency', 'district_presidency'],
  all_leaders:              ['bishop','stake_presidency','district_presidency',
                             'coordinating_council','area_authority','mission_president',
                             'mission_president_wife','area_presidency','general_authority',
                             'apostle','first_presidency','ysa_rep','ysa_adviser','it_support'],
};

const VALID_AUDIENCES = [
  'all', 'ysa_only', 'missionaries_only', 'ysa_and_missionaries',
  'ward_leaders', 'stake_district_presidents', 'all_leaders',
];

// Build WHERE clause fragment from an array of audience values.
// Returns '' if 'all' is included or array is empty (no role filter).
const buildAudienceWhereClause = (audiences) => {
  if (!audiences || audiences.length === 0 || audiences.includes('all')) return '';
  const roles = new Set();
  for (const a of audiences) {
    (AUDIENCE_ROLE_MAP[a] || []).forEach(r => roles.add(r));
  }
  if (roles.size === 0) return '';
  const list = [...roles].map(r => `'${r}'`).join(',');
  return `AND role = ANY(ARRAY[${list}])`;
};

// Fetch recipient IDs scoped by role + audience filter
const getRecipientIds = async (scope, scope_id, senderId, audiences = ['all']) => {
  const audienceWhere = buildAudienceWhereClause(audiences);
  let result;
  if (scope === 'global') {
    result = await query(
      `SELECT id FROM users WHERE id != $1 AND status NOT IN ('suspended') ${audienceWhere}`,
      [senderId]
    );
  } else if (scope === 'mission') {
    if (!scope_id) return [];
    result = await query(
      `SELECT id FROM users
       WHERE (mission_id = $1 OR mission_president_mission_id = $1)
         AND id != $2 AND status NOT IN ('suspended') ${audienceWhere}`,
      [scope_id, senderId]
    );
  } else if (scope === 'stake') {
    if (!scope_id) return [];
    result = await query(
      `SELECT id FROM users
       WHERE stake_id = $1 AND id != $2 AND status NOT IN ('suspended') ${audienceWhere}`,
      [scope_id, senderId]
    );
  } else if (scope === 'district') {
    if (!scope_id) return [];
    result = await query(
      `SELECT id FROM users
       WHERE district_id = $1 AND id != $2 AND status NOT IN ('suspended') ${audienceWhere}`,
      [scope_id, senderId]
    );
  } else {
    return [];
  }
  return result.rows.map(r => r.id);
};

// ── POST /api/announcements — Send an announcement ──────────────
router.post('/', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    if (!LEADER_ROLES.has(user.role)) {
      return res.status(403).json({ error: 'Only leaders can send announcements' });
    }

    const { title, body } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    // Accept 'audiences' (array) or legacy 'audience' (string), normalise to array
    let rawAudiences = req.body.audiences || (req.body.audience ? [req.body.audience] : ['all']);
    if (!Array.isArray(rawAudiences)) rawAudiences = [rawAudiences];
    const safeAudiences = rawAudiences.filter(a => VALID_AUDIENCES.includes(a));
    if (safeAudiences.length === 0) safeAudiences.push('all');

    const scopeInfo = getSenderScope(user);
    if (!scopeInfo) {
      return res.status(403).json({ error: 'Your role cannot send announcements' });
    }

    // Store audiences as JSON string
    const audienceJson = JSON.stringify(safeAudiences);
    const annResult = await query(
      `INSERT INTO announcements (id, sender_id, title, body, scope, scope_id, audience)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, sender_id, title, body, scope, scope_id, audience, created_at`,
      [uuidv4(), user.id, title.trim(), body.trim(), scopeInfo.scope, scopeInfo.scope_id, audienceJson]
    );
    const ann = annResult.rows[0];

    // Fetch recipients filtered by the combined audience set
    const recipientIds = await getRecipientIds(scopeInfo.scope, scopeInfo.scope_id, user.id, safeAudiences);

    if (recipientIds.length > 0) {
      // Bulk insert recipients using unnest to avoid UUID casting issues
      await query(
        `INSERT INTO announcement_recipients (announcement_id, user_id)
         SELECT $1::uuid, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [ann.id, recipientIds]
      );

      // Notify recipients via WebSocket
      const wsPayload = {
        type: 'new_announcement',
        payload: {
          id: ann.id,
          title: ann.title,
          body: ann.body,
          sender_name: user.full_name,
          sender_role: user.role,
          scope: ann.scope,
          audiences: safeAudiences,
          created_at: ann.created_at,
        },
      };

      // Fetch online recipients for WS + offline for push
      const onlineResult = await query(
        `SELECT u.id, u.fcm_token FROM users u WHERE u.id = ANY($1::uuid[])`,
        [recipientIds]
      );
      onlineResult.rows.forEach(r => {
        broadcast(r.id, wsPayload);
      });
    }

    res.status(201).json({ announcement: { ...ann, audiences: safeAudiences }, recipient_count: recipientIds.length });
  } catch (err) { next(err); }
});

// ── GET /api/announcements/sent — My sent announcements ─────────
router.get('/sent', authenticate, async (req, res, next) => {
  try {
    if (!LEADER_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Not a leader' });
    }
    const limit  = Math.min(parseInt(req.query.limit  || '50'), 100);
    const offset = parseInt(req.query.offset || '0');
    const result = await query(
      `SELECT a.id, a.title, a.body, a.scope, a.scope_id, a.audience, a.created_at,
              (SELECT COUNT(*) FROM announcement_recipients ar WHERE ar.announcement_id = a.id) AS recipient_count,
              (SELECT COUNT(*) FROM announcement_recipients ar WHERE ar.announcement_id = a.id AND ar.is_read = true) AS read_count
       FROM announcements a
       WHERE a.sender_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({ announcements: result.rows });
  } catch (err) { next(err); }
});

// ── PATCH /api/announcements/:id — Edit an announcement ─────────
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    if (!LEADER_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Not a leader' });
    }
    const { title, body } = req.body;
    if (!title?.trim() && !body?.trim()) {
      return res.status(400).json({ error: 'title or body required' });
    }
    // Only sender can edit
    const check = await query(
      `SELECT id FROM announcements WHERE id = $1 AND sender_id = $2`,
      [req.params.id, req.user.id]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not your announcement' });
    }
    const fields = [];
    const vals   = [];
    if (title?.trim()) { fields.push(`title = $${vals.length + 1}`); vals.push(title.trim()); }
    if (body?.trim())  { fields.push(`body  = $${vals.length + 1}`); vals.push(body.trim()); }
    vals.push(req.params.id);
    const result = await query(
      `UPDATE announcements SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json({ announcement: result.rows[0] });
  } catch (err) { next(err); }
});

// ── GET /api/announcements — Get my announcements ───────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '30'), 100);
    const offset = parseInt(req.query.offset || '0');
    const unreadOnly = req.query.unread === 'true';

    const whereExtra = unreadOnly ? 'AND ar.is_read = false' : '';
    const result = await query(
      `SELECT a.id, a.sender_id, a.title, a.body, a.scope, a.audience, a.created_at,
              u.full_name AS sender_name, u.role AS sender_role,
              u.profile_photo_url AS sender_photo,
              ar.is_read, ar.read_at
       FROM announcement_recipients ar
       JOIN announcements a ON a.id = ar.announcement_id
       JOIN users u ON u.id = a.sender_id
       WHERE ar.user_id = $1
         AND (ar.is_read = false OR ar.read_at > NOW() - INTERVAL '24 hours')
         ${whereExtra}
       ORDER BY a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const unreadCount = await query(
      `SELECT COUNT(*) FROM announcement_recipients
       WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );

    res.json({
      announcements: result.rows,
      unread_count: parseInt(unreadCount.rows[0].count),
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/announcements/:id/read ───────────────────────────
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    await query(
      `UPDATE announcement_recipients
       SET is_read = true, read_at = NOW()
       WHERE announcement_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/announcements/read-all ───────────────────────────
router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await query(
      `UPDATE announcement_recipients
       SET is_read = true, read_at = NOW()
       WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/announcements/unread-count ─────────────────────────
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT COUNT(*) FROM announcement_recipients ar
       JOIN announcements a ON a.id = ar.announcement_id
       WHERE ar.user_id = $1 AND ar.is_read = false
         AND (ar.read_at IS NULL OR ar.read_at > NOW() - INTERVAL '24 hours')`,
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) { next(err); }
});

module.exports = router;
