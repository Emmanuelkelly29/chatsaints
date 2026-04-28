'use strict';
const { query } = require('../config/database');
const { unenrollMissionaryDevice } = require('../services/maas360Service');

// GET /api/settings
const getSettings = async (req, res) => {
  try {
    const result = await query(
      `SELECT stealth_status_view, status_visibility_default,
              contact_request_preference, directory_visible,
              fcm_token IS NOT NULL as has_push_token,
              email, is_single, date_of_birth
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    return res.json(result.rows[0] || {});
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// PATCH /api/settings/notifications
const updateNotificationSettings = async (req, res) => {
  try {
    const { fcm_token, apns_token } = req.body;
    await query(
      `UPDATE users SET
         fcm_token  = COALESCE($1, fcm_token),
         apns_token = COALESCE($2, apns_token),
         updated_at = NOW()
       WHERE id = $3`,
      [fcm_token || null, apns_token || null, req.user.id]
    );
    return res.json({ message: 'Notification settings updated' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// PATCH /api/settings/privacy
const updatePrivacySettings = async (req, res) => {
  try {
    const {
      stealth_status_view,
      status_visibility_default,
      is_single,
      contact_request_preference,
      directory_visible,
    } = req.body;
    await query(
      `UPDATE users SET
         stealth_status_view       = COALESCE($1, stealth_status_view),
         status_visibility_default = COALESCE($2::status_visibility, status_visibility_default),
         is_single                 = COALESCE($3, is_single),
         contact_request_preference = COALESCE($4::contact_request_preference, contact_request_preference),
         directory_visible          = COALESCE($5, directory_visible),
         updated_at                 = NOW()
       WHERE id = $6`,
      [
        typeof stealth_status_view === 'boolean' ? stealth_status_view : null,
        status_visibility_default || null,
        typeof is_single === 'boolean' ? is_single : null,
        contact_request_preference || null,
        typeof directory_visible === 'boolean' ? directory_visible : null,
        req.user.id,
      ]
    );
    return res.json({ message: 'Privacy settings updated' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// PATCH /api/settings/profile
const updateProfileSettings = async (req, res) => {
  try {
    const { full_name, email, bio, profile_photo_url } = req.body;
    await query(
      `UPDATE users SET
         full_name         = COALESCE($1, full_name),
         email             = COALESCE($2, email),
         bio               = COALESCE($3, bio),
         profile_photo_url = COALESCE($4, profile_photo_url),
         updated_at        = NOW()
       WHERE id = $5`,
      [full_name || null, email || null, bio || null, profile_photo_url || null, req.user.id]
    );
    return res.json({ message: 'Profile updated' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// DELETE /api/settings/account
// Permanently deletes the account and all associated data
const deleteAccount = async (req, res) => {
  const userId = req.user.id;
  try {
    // Remove MaaS360 if missionary
    if (req.user.missionary_mode_active || req.user.role === 'missionary') {
      await unenrollMissionaryDevice(userId);
    }

    // Anonymise messages (keep history but remove sender identity)
    await query(
      `UPDATE messages SET sender_id = NULL, content = '[Deleted account]' WHERE sender_id = $1`,
      [userId]
    );

    // Remove from conversations, stake pool, statuses, views, approvals
    await query('DELETE FROM conversation_members WHERE user_id = $1', [userId]);
    await query('DELETE FROM stake_pool_members WHERE user_id = $1', [userId]);
    await query('DELETE FROM pinned_conversations WHERE user_id = $1', [userId]);
    await query('DELETE FROM status_views WHERE viewer_id = $1', [userId]);
    await query('DELETE FROM statuses WHERE user_id = $1', [userId]);
    await query('DELETE FROM leader_approvals WHERE applicant_id = $1', [userId]);
    await query('DELETE FROM contact_requests WHERE sender_id = $1 OR recipient_id = $1', [userId]);
    await query('DELETE FROM contact_connections WHERE user_low_id = $1 OR user_high_id = $1', [userId]);

    // Finally delete the user record
    await query('DELETE FROM users WHERE id = $1', [userId]);

    return res.json({ message: 'Account permanently deleted. We are sorry to see you go.' });
  } catch (err) {
    console.error('deleteAccount error:', err);
    return res.status(500).json({ error: 'Failed to delete account. Please try again.' });
  }
};

module.exports = { getSettings, updateNotificationSettings, updatePrivacySettings, updateProfileSettings, deleteAccount };
