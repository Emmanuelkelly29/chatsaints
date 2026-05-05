'use strict';
/**
 * ADMIN DASHBOARD CONTROLLER
 * For Area Authorities and above — gives a bird's-eye view of the platform.
 * Bishops get a narrower view scoped to their unit.
 */
const { query } = require('../config/database');
const { ROLE_TIER } = require('../utils/accessControl');

const getViewerScope = (user) => {
  const tier = ROLE_TIER[user.role] || 0;
  if (tier >= 6) return 'global';     // Area Authority and above
  if (tier === 5) return 'council';   // Coordinating council
  if (tier === 4) return 'stake';     // Stake-level (kept for compatibility)
  if (tier === 3) return 'ward';      // Bishop
  return null;
};

// GET /api/admin/dashboard — overview stats
const getDashboard = async (req, res) => {
  try {
    const scope = getViewerScope(req.user);
    if (!scope) return res.status(403).json({ error: 'Admin access required' });

    const stakeFilter = scope === 'stake' || scope === 'ward'
      ? `AND u.stake_id = '${req.user.stake_id}'`
      : '';

    const [
      userStats, missionaryStats, groupStats,
      messageStats, statusStats, pendingApprovals,
    ] = await Promise.all([
      // Total users by role
      query(`
        SELECT role, COUNT(*) as count, status
        FROM users
        WHERE 1=1 ${stakeFilter}
        GROUP BY role, status
        ORDER BY count DESC
      `),
      // Active missionaries
      query(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN maas360_enrolled THEN 1 ELSE 0 END) as mdm_enrolled
        FROM users WHERE role='missionary' ${stakeFilter}
      `),
      // Group conversations
      query(`
        SELECT COUNT(*) as total_groups,
               SUM(CASE WHEN is_group THEN 1 ELSE 0 END) as group_chats
        FROM conversations WHERE created_at > NOW() - INTERVAL '30 days'
      `),
      // Message volume (last 7 days)
      query(`
        SELECT
          DATE(created_at) as day,
          COUNT(*) as messages,
          COUNT(DISTINCT sender_id) as active_users
        FROM messages
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at) ORDER BY day
      `),
      // Active statuses
      query(`
        SELECT COUNT(*) as active_statuses,
               COUNT(DISTINCT user_id) as users_posting
        FROM statuses WHERE expires_at > NOW()
      `),
      // Pending leader approvals
      query(`
        SELECT COUNT(*) as pending
        FROM leader_approvals WHERE status='pending'
      `),
    ]);

    // Online users count (from redis would be ideal, approximating from last_seen)
    const onlineResult = await query(`
      SELECT COUNT(*) as online
      FROM users WHERE last_seen > NOW() - INTERVAL '5 minutes'
      ${stakeFilter}
    `);

    return res.json({
      scope,
      overview: {
        online_now:       parseInt(onlineResult.rows[0].online),
        pending_approvals: parseInt(pendingApprovals.rows[0].pending),
        active_missionaries: parseInt(missionaryStats.rows[0]?.total || 0),
        mdm_enrolled:     parseInt(missionaryStats.rows[0]?.mdm_enrolled || 0),
        active_statuses:  parseInt(statusStats.rows[0]?.active_statuses || 0),
        users_posting_today: parseInt(statusStats.rows[0]?.users_posting || 0),
      },
      users_by_role: userStats.rows,
      message_activity: messageStats.rows,
      groups: groupStats.rows[0],
    });
  } catch (err) {
    console.error('getDashboard error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

// GET /api/admin/users — paginated user list with filters
const getUserList = async (req, res) => {
  try {
    const scope = getViewerScope(req.user);
    if (!scope) return res.status(403).json({ error: 'Admin access required' });

    const {
      page = 1, limit = 50, role, status, stake_id, search,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const stakeFilter = (scope === 'stake' || scope === 'ward') && !stake_id
      ? req.user.stake_id : stake_id;

    const result = await query(
      `SELECT u.id, u.full_name, u.phone_number, u.email, u.role, u.status,
              u.is_approved, u.date_of_birth, u.profile_photo_url,
              u.missionary_mode_active,
              u.maas360_enrolled, u.last_seen, u.created_at,
              s.name as stake_name, m.name as mission_name
       FROM users u
       LEFT JOIN stakes s ON u.stake_id = s.id
       LEFT JOIN missions m ON u.mission_id = m.id
       WHERE ($1::text IS NULL OR u.role::text = $1)
         AND ($2::text IS NULL OR u.status::text = $2)
         AND ($3::uuid IS NULL OR u.stake_id = $3)
         AND ($4::text IS NULL OR u.full_name ILIKE $4 OR u.phone_number ILIKE $4)
       ORDER BY u.created_at DESC
       LIMIT $5 OFFSET $6`,
      [
        role || null,
        status || null,
        stakeFilter || null,
        search ? `%${search}%` : null,
        parseInt(limit),
        offset,
      ]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM users u
       WHERE ($1::text IS NULL OR u.role::text=$1)
         AND ($2::text IS NULL OR u.status::text=$2)
         AND ($3::uuid IS NULL OR u.stake_id=$3)
         AND ($4::text IS NULL OR u.full_name ILIKE $4 OR u.phone_number ILIKE $4)`,
      [role || null, status || null, stakeFilter || null, search ? `%${search}%` : null]
    );

    return res.json({
      users: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// PATCH /api/admin/users/:id/suspend — suspend or unsuspend an account
const suspendUser = async (req, res) => {
  try {
    const scope = getViewerScope(req.user);
    if (!scope || scope === 'ward') {
      return res.status(403).json({ error: 'Coordinating Council or above required' });
    }

    const { suspended, reason } = req.body;
    const targetId = req.params.id;

    // Cannot suspend someone at same or higher tier
    const targetResult = await query('SELECT role FROM users WHERE id=$1', [targetId]);
    if (!targetResult.rows.length) return res.status(404).json({ error: 'User not found' });

    const targetTier  = ROLE_TIER[targetResult.rows[0].role] || 0;
    const actorTier   = ROLE_TIER[req.user.role] || 0;
    if (targetTier >= actorTier) {
      return res.status(403).json({ error: 'Cannot suspend a user at your level or above' });
    }

    await query(
      `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`,
      [suspended ? 'suspended' : 'active', targetId]
    );

    return res.json({
      message: suspended ? `Account suspended: ${reason || 'No reason given'}` : 'Account reinstated',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

// GET /api/admin/missionary/overview — missionary stats for leaders
const getMissionaryOverview = async (req, res) => {
  try {
    const scope = getViewerScope(req.user);
    if (!scope) return res.status(403).json({ error: 'Admin access required' });

    const result = await query(`
      SELECT
        u.id, u.full_name, u.phone_number, u.profile_photo_url,
        u.missionary_start_date, u.missionary_end_date,
        u.maas360_enrolled, u.maas360_device_id,
        m.name as mission_name, m.country as mission_country
      FROM users u
      LEFT JOIN missions m ON u.mission_id = m.id
      WHERE u.role = 'missionary'
        OR u.missionary_mode_active = true
      ORDER BY u.missionary_start_date DESC
    `);

    const byMission = result.rows.reduce((acc, r) => {
      const key = r.mission_name || 'Unassigned';
      if (!acc[key]) acc[key] = { mission: key, country: r.mission_country, missionaries: [] };
      acc[key].missionaries.push(r);
      return acc;
    }, {});

    return res.json({
      total: result.rows.length,
      mdm_enrolled: result.rows.filter(r => r.maas360_enrolled).length,
      by_mission: Object.values(byMission),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

// GET /api/admin/stakes — all stakes with YSA pool status
const getStakesOverview = async (req, res) => {
  try {
    if (ROLE_TIER[req.user.role] < 4) {
      return res.status(403).json({ error: 'Stake Presidency or above required' });
    }

    const result = await query(`
      SELECT
        s.id, s.name, s.country, s.ysa_pool_active,
        cc.name as coordinating_council,
        a.name as area,
        (SELECT COUNT(*) FROM users WHERE stake_id=s.id AND role='ysa_member') as ysa_count,
        (SELECT COUNT(*) FROM stake_pool_members WHERE stake_id=s.id AND approved=true) as pool_members,
        (SELECT COUNT(*) FROM users WHERE stake_id=s.id AND role='missionary') as missionaries
      FROM stakes s
      JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
      JOIN areas a ON cc.area_id = a.id
      ORDER BY a.name, cc.name, s.name
    `);

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

module.exports = { getDashboard, getUserList, suspendUser, getMissionaryOverview, getStakesOverview };
