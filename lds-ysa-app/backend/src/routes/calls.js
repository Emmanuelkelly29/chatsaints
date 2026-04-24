'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate, requireActive } = require('../middleware/auth');

// GET /api/calls/history  — paginated call log for the current user (WhatsApp-style)
router.get('/history', authenticate, requireActive, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 100);
    const offset = parseInt(req.query.offset || '0', 10);

    // All calls where I am initiator or participant
    const result = await query(
      `SELECT
          c.id,
          c.call_type,
          c.status,
          c.started_at,
          c.ended_at,
          c.duration_seconds,
          c.created_at,
          c.initiated_by,
          -- other party info (first participant that is not me)
          op.id            AS other_user_id,
          op.full_name     AS other_user_name,
          op.profile_photo_url AS other_user_photo,
          op.role          AS other_user_role
       FROM calls c
       -- join participants to find "me"
       JOIN call_participants cp_me
         ON cp_me.call_id = c.id AND cp_me.user_id = $1
       -- join participants to find the other side
       LEFT JOIN call_participants cp_other
         ON cp_other.call_id = c.id AND cp_other.user_id <> $1
       LEFT JOIN users op ON op.id = cp_other.user_id
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    // Deduplicate: for group calls with many participants, take first other user
    const seen = new Set();
    const calls = [];
    for (const row of result.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        calls.push({
          id:              row.id,
          call_type:       row.call_type,
          status:          row.status,
          is_outgoing:     row.initiated_by === req.user.id,
          started_at:      row.started_at,
          ended_at:        row.ended_at,
          duration_seconds:row.duration_seconds,
          created_at:      row.created_at,
          other_user: row.other_user_id ? {
            id:    row.other_user_id,
            name:  row.other_user_name,
            photo: row.other_user_photo,
            role:  row.other_user_role,
          } : null,
        });
      }
    }
    res.json({ calls });
  } catch (err) { next(err); }
});

// POST /api/calls/initiate
router.post('/initiate', authenticate, requireActive, async (req, res, next) => {
  try {
    const { participantIds = [], type = 'voice', conversationId } = req.body;
    if (!Array.isArray(participantIds) || participantIds.length === 0)
      return res.status(400).json({ error: 'participantIds must be a non-empty array' });

    const callId = uuidv4();
    await query(
      `INSERT INTO calls (id, type, conversation_id, status, initiated_by)
       VALUES ($1, $2, $3, 'initiated', $4)`,
      [callId, type, conversationId || null, req.user.id]
    );

    const allParticipants = [...new Set([req.user.id, ...participantIds])];
    for (const uid of allParticipants) {
      await query(
        `INSERT INTO call_participants (id, call_id, user_id)
         VALUES ($1, $2, $3) ON CONFLICT (call_id, user_id) DO NOTHING`,
        [uuidv4(), callId, uid]
      );
    }

    const callResult = await query(
      `SELECT c.id, c.type, c.status, c.created_at,
              json_agg(json_build_object(
                'user_id', u.id,
                'full_name', u.full_name,
                'fcm_token', u.fcm_token
              )) AS participants
       FROM calls c
       JOIN call_participants cp ON c.id = cp.call_id
       JOIN users u ON cp.user_id = u.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [callId]
    );
    res.status(201).json({ call: callResult.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/calls/:id/status
router.patch('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const validStatuses = ['initiated', 'answered', 'declined', 'missed', 'ended'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });

    const result = await query(
      `UPDATE calls
       SET status = $1 ${status === 'ended' ? ', ended_at = NOW()' : ''}
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Call not found' });
    res.json({ call: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;

