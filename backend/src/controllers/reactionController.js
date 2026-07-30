'use strict';
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');

const ALLOWED_EMOJIS = ['👍','❤️','😂','😮','😢','🙏','🔥','✅','👏','💙'];

// POST /api/messages/:id/reactions
const addReaction = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { emoji } = req.body;

    if (!ALLOWED_EMOJIS.includes(emoji)) {
      return res.status(400).json({ error: `Emoji not allowed. Use: ${ALLOWED_EMOJIS.join(' ')}` });
    }

    // Verify message exists and user has access to that conversation
    const msgResult = await query(
      `SELECT m.id, m.conversation_id FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
       WHERE m.id = $1 AND cm.user_id = $2 AND cm.left_at IS NULL`,
      [messageId, req.user.id]
    );
    if (!msgResult.rows.length) {
      return res.status(404).json({ error: 'Message not found or access denied' });
    }

    await query(
      `INSERT INTO message_reactions (id, message_id, user_id, emoji)
       VALUES ($1, $2, $3, $4) ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
      [uuidv4(), messageId, req.user.id, emoji]
    );

    // Get updated reaction counts for this message
    const counts = await query(
      `SELECT emoji, COUNT(*) as count,
              ARRAY_AGG(u.full_name ORDER BY mr.created_at) as users
       FROM message_reactions mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = $1
       GROUP BY emoji ORDER BY count DESC`,
      [messageId]
    );

    return res.json({
      message_id: messageId,
      reactions: counts.rows,
    });
  } catch (err) {
    console.error('addReaction error:', err);
    return res.status(500).json({ error: 'Failed to add reaction' });
  }
};

// DELETE /api/messages/:id/reactions/:emoji
const removeReaction = async (req, res) => {
  try {
    const { id: messageId, emoji } = req.params;
    await query(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, req.user.id, decodeURIComponent(emoji)]
    );

    const counts = await query(
      `SELECT emoji, COUNT(*) as count,
              ARRAY_AGG(u.full_name ORDER BY mr.created_at) as users
       FROM message_reactions mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = $1
       GROUP BY emoji ORDER BY count DESC`,
      [messageId]
    );

    return res.json({ message_id: messageId, reactions: counts.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove reaction' });
  }
};

// GET /api/messages/:id/reactions
const getReactions = async (req, res) => {
  try {
    const result = await query(
      `SELECT emoji, COUNT(*) as count,
              ARRAY_AGG(json_build_object('id', u.id, 'name', u.full_name) ORDER BY mr.created_at) as users
       FROM message_reactions mr
       JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = $1
       GROUP BY emoji ORDER BY count DESC`,
      [req.params.id]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

module.exports = { addReaction, removeReaction, getReactions };
