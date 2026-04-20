'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate, requireActive } = require('../middleware/auth');

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

