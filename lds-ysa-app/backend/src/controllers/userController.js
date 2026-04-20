'use strict';
const { query } = require('../config/database');
const { canViewProfile, canSearchUser, getUserFeatureFlags, ROLE_TIER } = require('../utils/accessControl');

// GET /api/users/me
const getMe = async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id,u.full_name,u.phone_number,u.email,u.role,u.status,u.age,
              u.is_single,u.profile_photo_url,u.bio,u.is_approved,
              u.stake_id,u.mission_id,u.missionary_mode_active,
              s.name as stake_name, m.name as mission_name
       FROM users u
       LEFT JOIN stakes s ON u.stake_id=s.id
       LEFT JOIN missions m ON u.mission_id=m.id
       WHERE u.id=$1`, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];
    user.features = getUserFeatureFlags(user);
    return res.json(user);
  } catch (err) { return res.status(500).json({ error: 'Failed to fetch profile' }); }
};

// GET /api/users/search?q=name_or_phone
const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.status(400).json({ error: 'Search query too short' });

    const viewer = req.user;
    const viewerTier = ROLE_TIER[viewer.role] || 0;

    const result = await query(
      `SELECT id,full_name,phone_number,email,role,status,profile_photo_url,
              stake_id,mission_id,missionary_mode_active,profile_hidden
       FROM users
       WHERE (full_name ILIKE $1 OR phone_number ILIKE $1 OR email ILIKE $1)
         AND status != 'suspended'
       LIMIT 50`,
      [`%${q}%`]
    );

    // Filter by access control rules
    const visible = result.rows.filter(target => canSearchUser(viewer, target));
    return res.json(visible);
  } catch (err) { return res.status(500).json({ error: 'Search failed' }); }
};

// GET /api/users/:id
const getUserById = async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id,u.full_name,u.phone_number,u.email,u.role,u.status,u.age,
              u.profile_photo_url,u.bio,u.stake_id,u.mission_id,
              u.missionary_mode_active,u.profile_hidden,u.last_seen,
              s.name as stake_name, m.name as mission_name
       FROM users u
       LEFT JOIN stakes s ON u.stake_id=s.id
       LEFT JOIN missions m ON u.mission_id=m.id
       WHERE u.id=$1`, [req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const target = result.rows[0];

    if (!canViewProfile(req.user, target))
      return res.status(403).json({ error: 'You do not have permission to view this profile' });

    return res.json(target);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// PATCH /api/users/me
const updateProfile = async (req, res) => {
  try {
    const { full_name, bio, email, fcm_token, apns_token } = req.body;
    await query(
      `UPDATE users SET
         full_name=COALESCE($1,full_name),
         bio=COALESCE($2,bio),
         email=COALESCE($3,email),
         fcm_token=COALESCE($4,fcm_token),
         apns_token=COALESCE($5,apns_token),
         updated_at=NOW()
       WHERE id=$6`,
      [full_name||null, bio||null, email||null, fcm_token||null, apns_token||null, req.user.id]
    );
    return res.json({ message: 'Profile updated' });
  } catch (err) { return res.status(500).json({ error: 'Update failed' }); }
};

// GET /api/users/stake-pool — YSA members approved in same stake
const getStakePool = async (req, res) => {
  try {
    const user = req.user;
    if (!user.stake_id) return res.status(400).json({ error: 'No stake assigned' });

    const { getUserFeatureFlags: gff } = require('../utils/accessControl');
    const flags = gff(user);
    if (!flags.canBrowseStakePool)
      return res.status(403).json({ error: 'Missionary mode active — stake pool unavailable' });

    const result = await query(
      `SELECT u.id,u.full_name,u.phone_number,u.profile_photo_url,u.age,u.role,
              spm.stake_id, s.name as stake_name
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id=u.id
       JOIN stakes s ON spm.stake_id=s.id
       WHERE spm.approved=true AND s.ysa_pool_active=true
         AND u.status='active' AND u.missionary_mode_active=false
       ORDER BY u.full_name`,
      []
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed to fetch stake pool' }); }
};

module.exports = { getMe, searchUsers, getUserById, updateProfile, getStakePool };
