'use strict';
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { canJoinGroup, isMissionaryLocked } = require('../utils/accessControl');

// GET /api/conversations — list all conversations for current user
const listConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `SELECT c.id,c.name,c.is_group,c.photo_url,c.created_at,
              (SELECT content FROM messages WHERE conversation_id=c.id
               ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages WHERE conversation_id=c.id
               ORDER BY created_at DESC LIMIT 1) as last_message_at,
              (SELECT COUNT(*) FROM conversation_members WHERE conversation_id=c.id
               AND left_at IS NULL) as member_count,
              cm.is_admin,
              (SELECT COUNT(*) FROM messages m
               WHERE m.conversation_id=c.id AND m.created_at >
               COALESCE((SELECT read_at FROM message_reads mr2
                WHERE mr2.message_id=m.id AND mr2.user_id=$1 LIMIT 1), '1970-01-01')) as unread_count,
              -- For 1-on-1: get the OTHER user's name, photo, role
              (SELECT u2.full_name FROM conversation_members cm2
               JOIN users u2 ON u2.id=cm2.user_id
               WHERE cm2.conversation_id=c.id AND cm2.user_id != $1 AND cm2.left_at IS NULL
               LIMIT 1) as other_name,
              (SELECT u2.profile_photo_url FROM conversation_members cm2
               JOIN users u2 ON u2.id=cm2.user_id
               WHERE cm2.conversation_id=c.id AND cm2.user_id != $1 AND cm2.left_at IS NULL
               LIMIT 1) as other_photo,
              (SELECT u2.role FROM conversation_members cm2
               JOIN users u2 ON u2.id=cm2.user_id
               WHERE cm2.conversation_id=c.id AND cm2.user_id != $1 AND cm2.left_at IS NULL
               LIMIT 1) as other_role
       FROM conversations c
       JOIN conversation_members cm ON c.id=cm.conversation_id
       WHERE cm.user_id=$1 AND cm.left_at IS NULL
       ORDER BY last_message_at DESC NULLS LAST`,
      [userId]
    );

    // For 1-on-1 chats, use the other person's name/photo
    const rows = result.rows.map(r => ({
      ...r,
      name: r.is_group ? r.name : (r.other_name || r.name || 'Chat'),
      photo_url: r.is_group ? r.photo_url : (r.other_photo || r.photo_url),
      role: r.is_group ? null : r.other_role,
    }));

    return res.json({ data: rows });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/conversations — create 1-on-1 or group
const createConversation = async (req, res) => {
  try {
    const user = req.user;
    const { name, is_group = false, member_ids = [], description } = req.body;

    if (!member_ids.length) return res.status(400).json({ error: 'At least one member required' });
    if (member_ids.length > 999) return res.status(400).json({ error: 'Max group size is 1000' });

    const convId = uuidv4();
    const allMembers = [...new Set([user.id, ...member_ids])];

    // Missionary lock: can only create mission-scoped groups
    if (isMissionaryLocked(user) && is_group && !req.body.mission_id)
      return res.status(403).json({ error: 'Missionaries can only create mission-internal groups' });

    await query(
      `INSERT INTO conversations (id,name,is_group,description,created_by,mission_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [convId, name||null, is_group, description||null, user.id, req.body.mission_id||null]
    );

    // Add all members
    for (const memberId of allMembers) {
      await query(
        `INSERT INTO conversation_members (id,conversation_id,user_id,is_admin)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [uuidv4(), convId, memberId, memberId === user.id]
      );
    }

    const result = await query(
      `SELECT c.*,cm.is_admin FROM conversations c
       JOIN conversation_members cm ON c.id=cm.conversation_id
       WHERE c.id=$1 AND cm.user_id=$2`, [convId, user.id]);

    return res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Failed to create conversation' }); }
};

// GET /api/conversations/:id/messages
const getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, before } = req.query;

    // Verify membership
    const member = await query(
      'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
      [id, req.user.id]);
    if (!member.rows.length) return res.status(403).json({ error: 'Not a member of this conversation' });

    const result = await query(
      `SELECT m.id,m.type,m.content,m.media_url,m.created_at,m.reply_to_message_id,m.is_deleted,
              u.id as sender_id,u.full_name as sender_name,u.profile_photo_url as sender_photo
       FROM messages m JOIN users u ON m.sender_id=u.id
       WHERE m.conversation_id=$1 AND m.is_deleted=false
         ${before ? 'AND m.created_at < $3' : ''}
       ORDER BY m.created_at DESC LIMIT $2`,
      before ? [id, limit, before] : [id, limit]
    );

    return res.json({ data: result.rows.reverse() });
  } catch (err) { return res.status(500).json({ error: 'Failed to fetch messages' }); }
};

// POST /api/conversations/:id/pin
const pinConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const countResult = await query(
      'SELECT COUNT(*) FROM pinned_conversations WHERE user_id=$1', [req.user.id]);
    if (parseInt(countResult.rows[0].count) >= 3)
      return res.status(400).json({ error: 'Maximum 3 pinned chats allowed' });

    await query(
      `INSERT INTO pinned_conversations (id,user_id,conversation_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [uuidv4(), req.user.id, id]);
    return res.json({ message: 'Chat pinned' });
  } catch (err) { return res.status(500).json({ error: 'Failed to pin' }); }
};

// DELETE /api/conversations/:id/pin
const unpinConversation = async (req, res) => {
  try {
    await query('DELETE FROM pinned_conversations WHERE user_id=$1 AND conversation_id=$2',
      [req.user.id, req.params.id]);
    return res.json({ message: 'Unpinned' });
  } catch (err) { return res.status(500).json({ error: 'Failed to unpin' }); }
};

// GET /api/conversations/pinned
const getPinnedConversations = async (req, res) => {
  try {
    const result = await query(
      `SELECT c.id,c.name,c.is_group,c.photo_url,pc.pinned_at
       FROM pinned_conversations pc JOIN conversations c ON pc.conversation_id=c.id
       WHERE pc.user_id=$1 ORDER BY pc.pinned_at DESC`, [req.user.id]);
    return res.json({ data: result.rows });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/conversations/1on1 — find or create a 1-on-1 conversation
const findOrCreate1on1 = async (req, res) => {
  try {
    const userId = req.user.id;
    const { target_user_id } = req.body;
    if (!target_user_id) return res.status(400).json({ error: 'target_user_id is required' });
    if (target_user_id === userId) return res.status(400).json({ error: 'Cannot chat with yourself' });

    // Check if 1-on-1 already exists
    const existing = await query(
      `SELECT c.id FROM conversations c
       JOIN conversation_members cm1 ON c.id=cm1.conversation_id AND cm1.user_id=$1 AND cm1.left_at IS NULL
       JOIN conversation_members cm2 ON c.id=cm2.conversation_id AND cm2.user_id=$2 AND cm2.left_at IS NULL
       WHERE c.is_group=false
       LIMIT 1`,
      [userId, target_user_id]
    );

    if (existing.rows.length) {
      // Return existing conversation with member info
      const conv = await query(
        `SELECT c.id,c.name,c.is_group,c.photo_url,c.created_at,
                u.full_name as other_name, u.role as other_role, u.profile_photo_url as other_photo
         FROM conversations c
         JOIN conversation_members cm ON c.id=cm.conversation_id AND cm.user_id=$2 AND cm.left_at IS NULL
         JOIN users u ON u.id=$2
         WHERE c.id=$1`,
        [existing.rows[0].id, target_user_id]
      );
      const row = conv.rows[0];
      return res.json({
        id: row.id, name: row.other_name, is_group: false,
        photo_url: row.other_photo, role: row.other_role,
        member_count: 2, created: false,
      });
    }

    // Create new 1-on-1
    const convId = uuidv4();
    await query(
      `INSERT INTO conversations (id,is_group,created_by) VALUES ($1,false,$2)`,
      [convId, userId]
    );
    await query(
      `INSERT INTO conversation_members (id,conversation_id,user_id,is_admin)
       VALUES ($1,$2,$3,true),($4,$2,$5,false)`,
      [uuidv4(), convId, userId, uuidv4(), target_user_id]
    );

    const target = await query('SELECT full_name,role,profile_photo_url FROM users WHERE id=$1', [target_user_id]);
    const t = target.rows[0] || {};

    return res.status(201).json({
      id: convId, name: t.full_name, is_group: false,
      photo_url: t.profile_photo_url, role: t.role,
      member_count: 2, created: true,
    });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Failed to start conversation' }); }
};

module.exports = { listConversations, createConversation, getMessages, pinConversation, unpinConversation, getPinnedConversations, findOrCreate1on1 };
