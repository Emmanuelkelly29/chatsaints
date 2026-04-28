'use strict';
const { query } = require('../config/database');
const { enrollMissionaryDevice, unenrollMissionaryDevice } = require('../services/maas360Service');
const { notifyLeaderApprovalNeeded } = require('../services/notificationService');

// POST /api/missionary/activate
const activateMissionaryMode = async (req, res) => {
  try {
    const { user_id, mission_id, start_date } = req.body;
    const { ROLE_TIER } = require('../utils/accessControl');
    if (ROLE_TIER[req.user.role] < 4)
      return res.status(403).json({ error: 'Only Stake Presidency or above can activate missionary mode' });

    // Get user's phone number for MaaS360 enrollment
    const userResult = await query(
      'SELECT phone_number, full_name FROM users WHERE id = $1', [user_id]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const { phone_number, full_name } = userResult.rows[0];

    await query(
      `UPDATE users SET
         role='missionary', status='missionary',
         missionary_mode_active=true,
         mission_id=$1,
         missionary_start_date=$2,
         is_approved=true
       WHERE id=$3`,
      [mission_id, start_date || new Date(), user_id]
    );

    // Remove from YSA stake pool while on mission
    await query('UPDATE stake_pool_members SET approved=false WHERE user_id=$1', [user_id]);

    // Enroll device in MaaS360 MDM
    const mdmResult = await enrollMissionaryDevice(user_id, phone_number, full_name);

    return res.json({
      message: 'Missionary mode activated.',
      mdm: mdmResult.mock
        ? 'MaaS360 not configured — using development mode. Set MAAS360_* env vars for production.'
        : `Device enrolled. MaaS360 device ID: ${mdmResult.deviceId}`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to activate missionary mode' });
  }
};

// POST /api/missionary/deactivate
const deactivateMissionaryMode = async (req, res) => {
  try {
    const { user_id } = req.body;
    const { ROLE_TIER } = require('../utils/accessControl');
    if (ROLE_TIER[req.user.role] < 4)
      return res.status(403).json({ error: 'Insufficient permissions' });

    const userResult = await query(
      'SELECT EXTRACT(YEAR FROM AGE(date_of_birth))::INTEGER as age, stake_id, full_name FROM users WHERE id=$1', [user_id]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const { age, stake_id, full_name } = userResult.rows[0];

    await query(
      `UPDATE users SET
         role='ysa_member', status='active',
         missionary_mode_active=false,
         missionary_end_date=NOW()
       WHERE id=$1`,
      [user_id]
    );

    // Restore stake pool if under 35
    if (age <= 35 && stake_id) {
      await query(
        'INSERT INTO stake_pool_members (id,user_id,stake_id,approved) VALUES (gen_random_uuid(),$1,$2,false) ON CONFLICT DO NOTHING',
        [user_id, stake_id]
      );
    }

    // Remove MaaS360 MDM policy
    await unenrollMissionaryDevice(user_id);

    return res.json({
      message: age <= 35
        ? `${full_name} has returned. YSA access restored. Stake rep must re-approve pool membership.`
        : `${full_name} has returned. Account restored as general member.`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to deactivate missionary mode' });
  }
};

// GET /api/missionary/mission/:mission_id/members
const getMissionMembers = async (req, res) => {
  try {
    const user = req.user;
    const { mission_id } = req.params;
    const { ROLE_TIER } = require('../utils/accessControl');
    const isMissionPresident = user.role === 'mission_president' &&
      user.mission_president_mission_id === mission_id;
    const isAreaOrAbove = ROLE_TIER[user.role] >= 6;
    if (!isMissionPresident && !isAreaOrAbove)
      return res.status(403).json({ error: 'Access denied' });

    const result = await query(
          `SELECT u.id, u.full_name, u.phone_number, u.profile_photo_url,
            u.missionary_start_date, u.status,
            EXTRACT(YEAR FROM AGE(u.date_of_birth))::INTEGER as age,
            u.maas360_enrolled
       FROM users u
       WHERE u.mission_id=$1 AND u.role='missionary'
       ORDER BY u.full_name`,
      [mission_id]
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// GET /api/missionary/presidents
const getAllMissionPresidents = async (req, res) => {
  try {
    const { ROLE_TIER } = require('../utils/accessControl');
    const userTier = ROLE_TIER[req.user.role] || 0;
    const isMissionPresident = req.user.role === 'mission_president' || req.user.role === 'mission_president_wife';
    if (!isMissionPresident && userTier < 5)
      return res.status(403).json({ error: 'Access denied' });

    const result = await query(
      `SELECT u.id, u.full_name, u.phone_number, u.profile_photo_url, u.role,
              u.mission_president_mission_id, m.name as mission_name,
              spouse.id as spouse_id, spouse.full_name as spouse_name,
              spouse.profile_photo_url as spouse_photo
       FROM users u
       LEFT JOIN missions m ON u.mission_president_mission_id=m.id
       LEFT JOIN users spouse ON u.spouse_id=spouse.id
       WHERE u.role IN ('mission_president','mission_president_wife')
       ORDER BY m.name, u.full_name`,
      []
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

module.exports = { activateMissionaryMode, deactivateMissionaryMode, getMissionMembers, getAllMissionPresidents };
