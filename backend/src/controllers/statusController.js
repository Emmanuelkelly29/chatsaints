'use strict';
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { isMissionaryLocked } = require('../utils/accessControl');

/**
 * POST /api/statuses
 * Upload a new status (image or video). Media URL comes from /api/media/upload first.
 * Body: { media_url, media_type, caption, visibility, visibility_user_ids, duration_secs }
 */
const createStatus = async (req, res) => {
  try {
    const user = req.user;

    // Missionaries cannot post statuses visible outside their mission
    if (isMissionaryLocked(user)) {
      return res.status(403).json({ error: 'Missionaries cannot post public statuses' });
    }

    const {
      media_url,
      media_type = 'image',
      caption,
      text_content,                       // for text-only statuses
      background_color,                   // background colour for text statuses
      visibility = user.status_visibility_default || 'contacts_only',
      visibility_user_ids = [],   // for 'selected' or 'except'
      duration_secs = 5,
    } = req.body;

    // Text-only statuses don't need media_url
    const isTextStatus = media_type === 'text';
    if (!isTextStatus && !media_url) {
      return res.status(400).json({ error: 'media_url is required for image/video/voice statuses. Upload the file first via /api/media/upload' });
    }
    if (isTextStatus && !text_content) {
      return res.status(400).json({ error: 'text_content is required for text statuses' });
    }

    const validTypes = ['image', 'video', 'voice', 'text'];
    if (!validTypes.includes(media_type)) {
      return res.status(400).json({ error: `media_type must be one of: ${validTypes.join(', ')}` });
    }

    const parsedDuration = Number.parseInt(duration_secs, 10);
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      return res.status(400).json({ error: 'duration_secs must be a positive integer' });
    }
    if (media_type === 'video' && parsedDuration > 120) {
      return res.status(400).json({ error: 'Video status duration cannot exceed 120 seconds' });
    }

    const normalizedDuration = media_type === 'video'
      ? Math.min(parsedDuration, 120)
      : parsedDuration;

    const validVisibility = ['everyone', 'contacts_only', 'selected', 'except'];
    if (!validVisibility.includes(visibility)) {
      return res.status(400).json({ error: `visibility must be one of: ${validVisibility.join(', ')}` });
    }

    const statusId = uuidv4();

    await query(
      `INSERT INTO statuses
         (id, user_id, media_url, media_type, caption, text_content, background_color, visibility, duration_secs, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW() + INTERVAL '24 hours')`,
      [statusId, user.id, media_url || null, media_type, caption || null, text_content || null, background_color || null, visibility, normalizedDuration]
    );

    // Store per-user visibility list for 'selected' or 'except'
    if ((visibility === 'selected' || visibility === 'except') && visibility_user_ids.length > 0) {
      for (const uid of visibility_user_ids) {
        await query(
          `INSERT INTO status_visibility_users (id, status_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [uuidv4(), statusId, uid]
        );
      }
    }

    return res.status(201).json({
      message: 'Status posted successfully',
      status_id: statusId,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('createStatus error:', err);
    return res.status(500).json({ error: 'Failed to post status' });
  }
};

/**
 * GET /api/statuses/feed
 * Returns all active (non-expired) statuses from contacts the viewer is allowed to see.
 * Groups statuses by user, shows whether each has been viewed.
 * Respects visibility rules and missionary isolation.
 */
const getStatusFeed = async (req, res) => {
  try {
    const viewer = req.user;
    const isItSupport = viewer.role === 'it_support';

    // Build the feed: statuses from people who share a conversation with the viewer
    // OR are in the same stake pool — i.e., actual contacts
    // IT Support sees ALL statuses regardless of contact filter
    const result = await query(
      `SELECT
         s.id,
         s.user_id,
         s.media_url,
         s.media_type,
         s.caption,
         s.text_content,
         s.background_color,
         s.visibility,
         s.duration_secs,
         s.expires_at,
         s.created_at,
         u.full_name AS author_name,
         u.profile_photo_url AS author_photo,
         u.role AS author_role,
         u.missionary_mode_active,
         u.mission_id AS author_mission_id,

         -- Has this viewer already viewed this status?
         (SELECT viewer_id FROM status_views
          WHERE status_id = s.id AND viewer_id = $1 LIMIT 1) IS NOT NULL AS viewed,

         -- View count (only shown to status owner)
         (SELECT COUNT(*) FROM status_views
          WHERE status_id = s.id AND is_stealth = false) AS view_count

       FROM statuses s
       JOIN users u ON s.user_id = u.id

       -- Only non-expired statuses
       WHERE s.expires_at > NOW()
         AND s.user_id != $1

         -- Contacts filter: IT Support bypasses, others need shared conversation or stake pool
         AND (
           $2::boolean
           OR EXISTS (
             SELECT 1 FROM conversation_members cm1
             JOIN conversation_members cm2
               ON cm1.conversation_id = cm2.conversation_id
             WHERE cm1.user_id = $1
               AND cm2.user_id = s.user_id
               AND cm1.left_at IS NULL
               AND cm2.left_at IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM stake_pool_members spm1
             JOIN stake_pool_members spm2 ON spm1.stake_id = spm2.stake_id
             WHERE spm1.user_id = $1 AND spm2.user_id = s.user_id
               AND spm1.approved = true AND spm2.approved = true
           )
         )

       ORDER BY u.full_name ASC, s.created_at ASC`,
      [viewer.id, isItSupport]
    );

    // Apply visibility filtering in JS for 'selected' and 'except'
    const filtered = [];
    for (const row of result.rows) {
      const allowed = await isAllowedToView(viewer.id, row);
      if (allowed) filtered.push(row);
    }

    // Group by author
    const grouped = {};
    for (const s of filtered) {
      if (!grouped[s.user_id]) {
        grouped[s.user_id] = {
          user_id: s.user_id,
          author_name: s.author_name,
          author_photo: s.author_photo,
          author_role: s.author_role,
          all_viewed: true,
          statuses: [],
        };
      }
      if (!s.viewed) grouped[s.user_id].all_viewed = false;
      grouped[s.user_id].statuses.push({
        id: s.id,
        media_url: s.media_url,
        media_type: s.media_type,
        caption: s.caption,
        text_content: s.text_content,
        background_color: s.background_color,
        duration_secs: s.duration_secs,
        expires_at: s.expires_at,
        created_at: s.created_at,
        viewed: s.viewed,
      });
    }

    // Sort: unviewed contacts first, then viewed
    const list = Object.values(grouped).sort((a, b) => {
      if (a.all_viewed !== b.all_viewed) return a.all_viewed ? 1 : -1;
      return 0;
    });

    return res.json(list);
  } catch (err) {
    console.error('getStatusFeed error:', err);
    return res.status(500).json({ error: 'Failed to load status feed' });
  }
};

/**
 * GET /api/statuses/mine
 * Returns the current user's own statuses with full viewer list (non-stealth only).
 */
const getMyStatuses = async (req, res) => {
  try {
    const statusResult = await query(
      `SELECT id, media_url, media_type, caption, text_content, background_color, visibility, duration_secs, expires_at, created_at
       FROM statuses
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    const statuses = [];
    for (const s of statusResult.rows) {
      // Get non-stealth viewers for each status
      const viewerResult = await query(
        `SELECT sv.viewer_id, sv.viewed_at, u.full_name, u.profile_photo_url
         FROM status_views sv
         JOIN users u ON sv.viewer_id = u.id
         WHERE sv.status_id = $1 AND sv.is_stealth = false
         ORDER BY sv.viewed_at DESC`,
        [s.id]
      );

      const stealthCount = await query(
        `SELECT COUNT(*) FROM status_views WHERE status_id = $1 AND is_stealth = true`,
        [s.id]
      );

      statuses.push({
        ...s,
        viewers: viewerResult.rows,
        view_count: viewerResult.rows.length,
        stealth_view_count: parseInt(stealthCount.rows[0].count),
      });
    }

    return res.json(statuses);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load your statuses' });
  }
};

/**
 * POST /api/statuses/:id/view
 * Mark a status as viewed. If viewer has stealth mode on, they stay anonymous.
 * Body: { stealth } — optional override (true/false)
 */
const viewStatus = async (req, res) => {
  try {
    const viewer = req.user;
    const { id: statusId } = req.params;

    // Check status exists and is not expired
    const statusResult = await query(
      `SELECT id, user_id, visibility FROM statuses WHERE id = $1 AND expires_at > NOW()`,
      [statusId]
    );
    if (!statusResult.rows.length) {
      return res.status(404).json({ error: 'Status not found or has expired' });
    }

    const status = statusResult.rows[0];

    // Verify viewer is allowed to see this status
    const allowed = await isAllowedToView(viewer.id, status);
    if (!allowed) {
      return res.status(403).json({ error: 'You are not allowed to view this status' });
    }

    // Determine stealth mode: user setting OR per-request override
    let stealthView = viewer.stealth_status_view || false;
    if (typeof req.body.stealth === 'boolean') {
      stealthView = req.body.stealth;
    }

    // Upsert view record (if already viewed, just update viewed_at)
    await query(
      `INSERT INTO status_views (id, status_id, viewer_id, viewed_at, is_stealth)
       VALUES ($1,$2,$3,NOW(),$4)
       ON CONFLICT (status_id, viewer_id)
       DO UPDATE SET viewed_at=NOW(), is_stealth=$4`,
      [uuidv4(), statusId, viewer.id, stealthView]
    );

    return res.json({
      message: stealthView ? 'Viewed anonymously' : 'View recorded',
      stealth: stealthView,
    });
  } catch (err) {
    console.error('viewStatus error:', err);
    return res.status(500).json({ error: 'Failed to record view' });
  }
};

/**
 * DELETE /api/statuses/:id
 * Owner deletes their own status before 24h expires.
 */
const deleteStatus = async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM statuses WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Status not found or not yours' });
    }
    return res.json({ message: 'Status deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete status' });
  }
};

/**
 * PATCH /api/statuses/settings
 * Update user's default visibility and stealth preferences.
 * Body: { stealth_status_view, status_visibility_default }
 */
const updateStatusSettings = async (req, res) => {
  try {
    const { stealth_status_view, status_visibility_default } = req.body;
    const valid = ['everyone', 'contacts_only', 'selected', 'except'];

    if (status_visibility_default && !valid.includes(status_visibility_default)) {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }

    await query(
      `UPDATE users SET
         stealth_status_view = COALESCE($1, stealth_status_view),
         status_visibility_default = COALESCE($2, status_visibility_default),
         updated_at = NOW()
       WHERE id = $3`,
      [
        typeof stealth_status_view === 'boolean' ? stealth_status_view : null,
        status_visibility_default || null,
        req.user.id,
      ]
    );

    return res.json({ message: 'Status settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update settings' });
  }
};

/**
 * GET /api/statuses/:id/viewers
 * Status owner gets the list of visible viewers + stealth count.
 */
const getStatusViewers = async (req, res) => {
  try {
    const { id } = req.params;
    const statusResult = await query(
      `SELECT id, user_id FROM statuses WHERE id = $1`, [id]
    );
    if (!statusResult.rows.length) return res.status(404).json({ error: 'Not found' });
    if (statusResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the status owner can see viewers' });
    }

    const viewers = await query(
      `SELECT sv.viewer_id, sv.viewed_at, sv.is_stealth,
              u.full_name, u.profile_photo_url
       FROM status_views sv JOIN users u ON sv.viewer_id = u.id
       WHERE sv.status_id = $1
       ORDER BY sv.viewed_at DESC`,
      [id]
    );

    const visible = viewers.rows.filter(v => !v.is_stealth);
    const stealthCount = viewers.rows.filter(v => v.is_stealth).length;

    return res.json({
      viewers: visible,
      view_count: visible.length,
      stealth_count: stealthCount,
      total_views: viewers.rows.length,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

// ── Helper ──────────────────────────────────────────────────────

/**
 * Check if a viewer is allowed to see a specific status based on its visibility setting.
 */
const isAllowedToView = async (viewerId, status) => {
  const { id: statusId, user_id: ownerId, visibility } = status;

  // Owner always sees their own
  if (viewerId === ownerId) return true;

  switch (visibility) {
    case 'everyone':
      return true;

    case 'contacts_only':
      return true; // Already filtered at the query level in getStatusFeed

    case 'selected': {
      // Only specific users in the list
      const r = await query(
        `SELECT 1 FROM status_visibility_users WHERE status_id=$1 AND user_id=$2`,
        [statusId, viewerId]
      );
      return r.rows.length > 0;
    }

    case 'except': {
      // Everyone EXCEPT users in the list
      const r = await query(
        `SELECT 1 FROM status_visibility_users WHERE status_id=$1 AND user_id=$2`,
        [statusId, viewerId]
      );
      return r.rows.length === 0;
    }

    default:
      return false;
  }
};

module.exports = {
  createStatus,
  getStatusFeed,
  getMyStatuses,
  viewStatus,
  deleteStatus,
  updateStatusSettings,
  getStatusViewers,
};
