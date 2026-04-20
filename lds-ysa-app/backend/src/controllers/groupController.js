'use strict';
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { canJoinGroup, isMissionaryLocked } = require('../utils/accessControl');

// POST /api/groups — create a group conversation
const createGroup = async (req, res) => {
  try {
    const user = req.user;
    const { name, description, member_ids = [], photo_url } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Group name must be at least 2 characters' });
    }
    if (member_ids.length > 999) {
      return res.status(400).json({ error: 'Maximum group size is 1,000 members' });
    }

    // Missionary check
    if (isMissionaryLocked(user) && !req.body.mission_id) {
      return res.status(403).json({ error: 'Missionaries can only create mission-scoped groups' });
    }

    const groupId = uuidv4();
    const allMembers = [...new Set([user.id, ...member_ids])];

    await query(
      `INSERT INTO conversations
         (id, name, description, is_group, photo_url, created_by, mission_id)
       VALUES ($1, $2, $3, true, $4, $5, $6)`,
      [groupId, name.trim(), description || null, photo_url || null,
       user.id, req.body.mission_id || null]
    );

    for (const memberId of allMembers) {
      await query(
        `INSERT INTO conversation_members (id, conversation_id, user_id, is_admin)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [uuidv4(), groupId, memberId, memberId === user.id]
      );
    }

    const result = await query(
      `SELECT c.*, cm.is_admin,
              (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id AND left_at IS NULL) as member_count
       FROM conversations c
       JOIN conversation_members cm ON c.id = cm.conversation_id AND cm.user_id = $1
       WHERE c.id = $2`,
      [user.id, groupId]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createGroup error:', err);
    return res.status(500).json({ error: 'Failed to create group' });
  }
};

// GET /api/groups/:id — get group info and members
const getGroupInfo = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify membership
    const memberCheck = await query(
      'SELECT is_admin FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
      [id, req.user.id]
    );
    if (!memberCheck.rows.length) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const groupResult = await query(
      `SELECT c.id, c.name, c.description, c.photo_url, c.created_at,
              c.only_admins_can_message, c.only_admins_can_edit,
              (SELECT COUNT(*) FROM conversation_members WHERE conversation_id=c.id AND left_at IS NULL) as member_count
       FROM conversations c WHERE c.id=$1 AND c.is_group=true`,
      [id]
    );
    if (!groupResult.rows.length) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const membersResult = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, u.phone_number,
              cm.is_admin, cm.joined_at
       FROM conversation_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.conversation_id = $1 AND cm.left_at IS NULL
       ORDER BY cm.is_admin DESC, u.full_name ASC`,
      [id]
    );

    return res.json({
      ...groupResult.rows[0],
      is_admin: memberCheck.rows[0].is_admin,
      members: membersResult.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch group info' });
  }
};

// PATCH /api/groups/:id — update group name, description, photo
const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, photo_url, only_admins_can_message } = req.body;

    // Must be admin
    const adminCheck = await query(
      'SELECT is_admin FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
      [id, req.user.id]
    );
    if (!adminCheck.rows.length || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Only group admins can edit group settings' });
    }

    await query(
      `UPDATE conversations SET
         name                     = COALESCE($1, name),
         description              = COALESCE($2, description),
         photo_url                = COALESCE($3, photo_url),
         only_admins_can_message  = COALESCE($4, only_admins_can_message),
         updated_at               = NOW()
       WHERE id = $5`,
      [name || null, description || null, photo_url || null,
       typeof only_admins_can_message === 'boolean' ? only_admins_can_message : null, id]
    );

    return res.json({ message: 'Group updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update group' });
  }
};

// POST /api/groups/:id/members — add members to group
const addMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { member_ids = [] } = req.body;

    // Check current member count
    const countResult = await query(
      'SELECT COUNT(*) FROM conversation_members WHERE conversation_id=$1 AND left_at IS NULL',
      [id]
    );
    const currentCount = parseInt(countResult.rows[0].count);
    if (currentCount + member_ids.length > 1000) {
      return res.status(400).json({ error: `Adding ${member_ids.length} members would exceed the 1,000 member limit` });
    }

    let added = 0;
    for (const memberId of member_ids) {
      const result = await query(
        `INSERT INTO conversation_members (id, conversation_id, user_id, is_admin)
         VALUES ($1, $2, $3, false) ON CONFLICT (conversation_id, user_id) DO NOTHING RETURNING id`,
        [uuidv4(), id, memberId]
      );
      if (result.rows.length) added++;
    }

    return res.json({ message: `${added} member${added !== 1 ? 's' : ''} added` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add members' });
  }
};

// DELETE /api/groups/:id/members/:userId — remove a member (admin only) or self-leave
const removeMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const isSelf = userId === req.user.id;

    if (!isSelf) {
      // Must be admin to remove others
      const adminCheck = await query(
        'SELECT is_admin FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
        [id, req.user.id]
      );
      if (!adminCheck.rows[0]?.is_admin) {
        return res.status(403).json({ error: 'Only admins can remove other members' });
      }
    }

    await query(
      'UPDATE conversation_members SET left_at=NOW() WHERE conversation_id=$1 AND user_id=$2',
      [id, userId]
    );

    return res.json({ message: isSelf ? 'You left the group' : 'Member removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

// PATCH /api/groups/:id/members/:userId/admin — promote/demote admin
const toggleAdmin = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { is_admin } = req.body;

    const adminCheck = await query(
      'SELECT is_admin FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
      [id, req.user.id]
    );
    if (!adminCheck.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Only admins can promote or demote members' });
    }

    await query(
      'UPDATE conversation_members SET is_admin=$1 WHERE conversation_id=$2 AND user_id=$3',
      [is_admin, id, userId]
    );

    return res.json({ message: is_admin ? 'Member promoted to admin' : 'Admin role removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

module.exports = { createGroup, getGroupInfo, updateGroup, addMembers, removeMember, toggleAdmin };
