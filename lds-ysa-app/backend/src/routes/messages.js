'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate, requireActive } = require('../middleware/auth');

// GET /api/messages/:conversationId
router.get('/:conversationId', authenticate, requireActive, async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before; // ISO timestamp cursor

    // Verify user is in conversation
    const memberCheck = await query(
      `SELECT 1 FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [conversationId, req.user.id]
    );
    if (!memberCheck.rows.length)
      return res.status(403).json({ error: 'Not in this conversation' });

    const messages = await query(
      `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.content,
              m.media_url, m.media_size_bytes, m.media_duration_secs,
              m.reply_to_message_id, m.is_deleted, m.created_at,
              json_build_object('id', s.id, 'full_name', s.full_name,
                'profile_photo_url', s.profile_photo_url) AS sender,
              CASE WHEN m.reply_to_message_id IS NOT NULL THEN
                json_build_object('id', rm.id, 'content', rm.content,
                  'sender_id', rm.sender_id)
              ELSE NULL END AS reply_to
       FROM messages m
       JOIN users s ON m.sender_id = s.id
       LEFT JOIN messages rm ON m.reply_to_message_id = rm.id
       WHERE m.conversation_id = $1
         AND m.is_deleted = false
         ${before ? 'AND m.created_at < $3' : ''}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      before ? [conversationId, limit, new Date(before)] : [conversationId, limit]
    );

    // Mark messages as read (upsert into message_reads)
    for (const msg of messages.rows) {
      if (msg.sender_id !== req.user.id) {
        await query(
          `INSERT INTO message_reads (id, message_id, user_id)
           VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id) DO NOTHING`,
          [uuidv4(), msg.id, req.user.id]
        );
      }
    }

    res.json({ messages: messages.rows.reverse() });
  } catch (err) { next(err); }
});

// DELETE /api/messages/:id — soft delete
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const message = await query(
      'SELECT id, sender_id FROM messages WHERE id = $1',
      [req.params.id]
    );
    if (!message.rows.length) return res.status(404).json({ error: 'Message not found' });
    if (message.rows[0].sender_id !== req.user.id)
      return res.status(403).json({ error: 'Not your message' });

    await query(
      `UPDATE messages SET is_deleted = true, content = null, deleted_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Message deleted' });
  } catch (err) { next(err); }
});

module.exports = router;

