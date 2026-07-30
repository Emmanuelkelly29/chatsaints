'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { authenticate, requireApproved, requireActive } = require('../middleware/auth');

const router = express.Router();
const mw = [authenticate, requireApproved, requireActive];

// ── Helpers ──────────────────────────────────────────────────────

function generateMeetingCode() {
  // Generates 9-digit code formatted as "123-456-789"
  const n = Math.floor(100000000 + Math.random() * 900000000).toString();
  return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6,9)}`;
}

async function getMeeting(id) {
  const r = await query(
    `SELECT m.*, u.full_name AS host_name, u.role AS host_role
     FROM meetings m JOIN users u ON u.id = m.host_id
     WHERE m.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

async function activeParticipants(meetingId) {
  const r = await query(
    `SELECT mp.*, u.full_name, u.profile_photo_url
     FROM meeting_participants mp JOIN users u ON u.id = mp.user_id
     WHERE mp.meeting_id = $1 AND mp.left_at IS NULL
     ORDER BY mp.joined_at ASC`,
    [meetingId]
  );
  return r.rows;
}

// ── POST / — Create a meeting ─────────────────────────────────────
router.post('/', mw, async (req, res) => {
  try {
    const { title, description, join_key, requires_approval = false,
            allow_link_join = true, max_participants = 1000, co_host_ids = [] } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    if (max_participants < 2 || max_participants > 1000)
      return res.status(400).json({ error: 'max_participants must be 2–1000' });

    const meetingId = uuidv4();
    let code = generateMeetingCode();
    // Ensure uniqueness (retry once on collision)
    const exists = await query('SELECT 1 FROM meetings WHERE meeting_code=$1', [code]);
    if (exists.rows.length) code = generateMeetingCode();

    let keyHash = null;
    if (join_key?.trim()) keyHash = await bcrypt.hash(join_key.trim(), 10);

    await query(
      `INSERT INTO meetings
         (id, host_id, title, description, meeting_code, join_key,
          requires_approval, allow_link_join, max_participants, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting', NOW())`,
      [meetingId, req.user.id, title.trim(), description?.trim() || null,
       code, keyHash, requires_approval, allow_link_join, max_participants]
    );

    // Add host as participant with role 'host'
    await query(
      `INSERT INTO meeting_participants (id, meeting_id, user_id, role)
       VALUES ($1,$2,$3,'host')`,
      [uuidv4(), meetingId, req.user.id]
    );

    // Add co-hosts
    if (Array.isArray(co_host_ids) && co_host_ids.length) {
      for (const coHostId of co_host_ids) {
        if (coHostId === req.user.id) continue;
        await query(
          `INSERT INTO meeting_participants (id, meeting_id, user_id, role)
           VALUES ($1,$2,$3,'co_host') ON CONFLICT (meeting_id, user_id) DO NOTHING`,
          [uuidv4(), meetingId, coHostId]
        );
      }
    }

    const meeting = await getMeeting(meetingId);
    res.status(201).json({ ...meeting, join_key: undefined /* never send hash */ });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// ── GET /code/:code — Preview by meeting code ─────────────────────
router.get('/code/:code', mw, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.id, m.title, m.description, m.meeting_code, m.requires_approval,
              m.allow_link_join, m.status, m.max_participants,
              (JOIN_KEY IS NOT NULL) AS has_key,
              u.full_name AS host_name,
              (SELECT COUNT(*) FROM meeting_participants
               WHERE meeting_id = m.id AND left_at IS NULL)::int AS participant_count
       FROM meetings m JOIN users u ON u.id = m.host_id
       WHERE m.meeting_code = $1`,
      [req.params.code]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Meeting not found' });
    const m = r.rows[0];
    if (m.status === 'ended') return res.status(410).json({ error: 'Meeting has ended' });
    res.json(m);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
});

// ── GET /:id — Full meeting details (participants must be in meeting) ──
router.get('/:id', mw, async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    // Check user is host or participant
    const pCheck = await query(
      `SELECT role FROM meeting_participants
       WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [meeting.id, req.user.id]
    );
    if (!pCheck.rows.length && meeting.host_id !== req.user.id)
      return res.status(403).json({ error: 'Not a participant' });

    const participants = await activeParticipants(meeting.id);
    const pendingReqs = meeting.host_id === req.user.id
      ? (await query(
          `SELECT mjr.*, u.full_name, u.profile_photo_url
           FROM meeting_join_requests mjr JOIN users u ON u.id = mjr.user_id
           WHERE mjr.meeting_id=$1 AND mjr.status='pending'
           ORDER BY mjr.requested_at ASC`,
          [meeting.id]
        )).rows
      : [];

    res.json({ ...meeting, join_key: undefined, participants, pending_requests: pendingReqs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
});

// ── GET /my/active — My active meetings ───────────────────────────
router.get('/my/active', mw, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.id, m.title, m.meeting_code, m.status, m.requires_approval,
              m.allow_link_join, m.created_at, u.full_name AS host_name,
              (m.host_id = $1) AS am_host,
              mp.role AS my_role,
              (SELECT COUNT(*) FROM meeting_participants
               WHERE meeting_id=m.id AND left_at IS NULL)::int AS participant_count
       FROM meeting_participants mp
       JOIN meetings m ON m.id = mp.meeting_id
       JOIN users u ON u.id = m.host_id
       WHERE mp.user_id=$1 AND m.status != 'ended'
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

// ── POST /:id/join — Join or request to join ──────────────────────
router.post('/:id/join', mw, async (req, res) => {
  try {
    const { join_key } = req.body;
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status === 'ended') return res.status(410).json({ error: 'Meeting has ended' });
    if (!meeting.allow_link_join && meeting.host_id !== req.user.id)
      return res.status(403).json({ error: 'Link joining is disabled for this meeting' });

    // Check capacity
    const countRes = await query(
      'SELECT COUNT(*) FROM meeting_participants WHERE meeting_id=$1 AND left_at IS NULL',
      [meeting.id]
    );
    if (parseInt(countRes.rows[0].count) >= meeting.max_participants)
      return res.status(403).json({ error: 'Meeting is at full capacity' });

    // Key check
    if (meeting.join_key) {
      if (!join_key) return res.status(401).json({ error: 'Meeting key required', key_required: true });
      const valid = await bcrypt.compare(join_key, meeting.join_key);
      if (!valid) return res.status(401).json({ error: 'Incorrect meeting key' });
    }

    // Already in?
    const existing = await query(
      'SELECT * FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2',
      [meeting.id, req.user.id]
    );
    if (existing.rows.length && !existing.rows[0].left_at)
      return res.json({ status: 'joined', meeting_id: meeting.id });

    // Requires approval?
    if (meeting.requires_approval && meeting.host_id !== req.user.id) {
      // Check existing request
      const reqCheck = await query(
        `SELECT * FROM meeting_join_requests WHERE meeting_id=$1 AND user_id=$2`,
        [meeting.id, req.user.id]
      );
      if (reqCheck.rows.length) {
        const r = reqCheck.rows[0];
        if (r.status === 'pending')   return res.json({ status: 'pending_approval' });
        if (r.status === 'approved')  { /* fall through to join */ }
        if (r.status === 'rejected')
          return res.status(403).json({ error: 'Your join request was rejected' });
      } else {
        await query(
          `INSERT INTO meeting_join_requests (id, meeting_id, user_id) VALUES ($1,$2,$3)
           ON CONFLICT (meeting_id, user_id) DO UPDATE SET status='pending', requested_at=NOW()`,
          [uuidv4(), meeting.id, req.user.id]
        );
        return res.status(202).json({ status: 'pending_approval' });
      }
    }

    // Join directly
    if (existing.rows.length) {
      await query(
        'UPDATE meeting_participants SET joined_at=NOW(), left_at=NULL WHERE meeting_id=$1 AND user_id=$2',
        [meeting.id, req.user.id]
      );
    } else {
      await query(
        `INSERT INTO meeting_participants (id, meeting_id, user_id, role) VALUES ($1,$2,$3,'attendee')`,
        [uuidv4(), meeting.id, req.user.id]
      );
    }

    // Activate meeting if still waiting
    if (meeting.status === 'waiting') {
      await query(`UPDATE meetings SET status='active' WHERE id=$1`, [meeting.id]);
    }

    const participants = await activeParticipants(meeting.id);
    res.json({ status: 'joined', meeting_id: meeting.id, participants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join meeting' });
  }
});

// ── POST /:id/approve/:userId — Host approves join request ────────
router.post('/:id/approve/:userId', mw, async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    // Only host or co-host can approve
    const roleRes = await query(
      `SELECT role FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [meeting.id, req.user.id]
    );
    const myRole = roleRes.rows[0]?.role;
    if (meeting.host_id !== req.user.id && myRole !== 'co_host')
      return res.status(403).json({ error: 'Only host or co-host can approve' });

    await query(
      `UPDATE meeting_join_requests SET status='approved', resolved_at=NOW()
       WHERE meeting_id=$1 AND user_id=$2`,
      [meeting.id, req.params.userId]
    );

    // Add participant
    await query(
      `INSERT INTO meeting_participants (id, meeting_id, user_id, role) VALUES ($1,$2,$3,'attendee')
       ON CONFLICT (meeting_id, user_id) DO UPDATE SET left_at=NULL, joined_at=NOW()`,
      [uuidv4(), meeting.id, req.params.userId]
    );

    res.json({ status: 'approved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

// ── POST /:id/reject/:userId — Host rejects join request ──────────
router.post('/:id/reject/:userId', mw, async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const roleRes = await query(
      `SELECT role FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [meeting.id, req.user.id]
    );
    const myRole = roleRes.rows[0]?.role;
    if (meeting.host_id !== req.user.id && myRole !== 'co_host')
      return res.status(403).json({ error: 'Only host or co-host can reject' });

    await query(
      `UPDATE meeting_join_requests SET status='rejected', resolved_at=NOW()
       WHERE meeting_id=$1 AND user_id=$2`,
      [meeting.id, req.params.userId]
    );

    res.json({ status: 'rejected' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// ── POST /:id/leave — Caller leaves without ending the meeting ────
router.post('/:id/leave', mw, async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status === 'ended') return res.status(410).json({ error: 'Meeting has ended' });

    await query(
      `UPDATE meeting_participants SET left_at=NOW()
       WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [meeting.id, req.user.id]
    );
    res.json({ status: 'left' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to leave meeting' });
  }
});

// ── POST /:id/add-cohost — Host adds a co-host during meeting ─────
router.post('/:id/add-cohost', mw, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status === 'ended') return res.status(410).json({ error: 'Meeting has ended' });
    if (meeting.host_id !== req.user.id)
      return res.status(403).json({ error: 'Only the host can add co-hosts' });
    if (user_id === req.user.id)
      return res.status(400).json({ error: 'Cannot add yourself as co-host' });

    // Upsert: promote existing participant or pre-add for when they join
    await query(
      `INSERT INTO meeting_participants (id, meeting_id, user_id, role)
       VALUES ($1,$2,$3,'co_host')
       ON CONFLICT (meeting_id, user_id) DO UPDATE SET role='co_host'`,
      [uuidv4(), meeting.id, user_id]
    );
    res.json({ status: 'co_host_added', user_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add co-host' });
  }
});

// ── PATCH /:id/promote/:userId — Promote participant ──────────────
router.patch('/:id/promote/:userId', mw, async (req, res) => {
  try {
    const { role } = req.body; // 'co_host' | 'presenter' | 'attendee'
    const allowed = ['co_host', 'presenter', 'attendee'];
    if (!allowed.includes(role))
      return res.status(400).json({ error: 'Invalid role' });

    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.host_id !== req.user.id)
      return res.status(403).json({ error: 'Only host can promote participants' });

    await query(
      `UPDATE meeting_participants SET role=$1 WHERE meeting_id=$2 AND user_id=$3`,
      [role, meeting.id, req.params.userId]
    );
    res.json({ status: 'promoted', role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to promote participant' });
  }
});

// ── PATCH /:id/mute/:userId — Host mutes participant ──────────────
router.patch('/:id/mute/:userId', mw, async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const roleRes = await query(
      `SELECT role FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [meeting.id, req.user.id]
    );
    const myRole = roleRes.rows[0]?.role;
    if (meeting.host_id !== req.user.id && myRole !== 'co_host')
      return res.status(403).json({ error: 'Only host or co-host can mute others' });

    await query(
      `UPDATE meeting_participants SET is_muted=TRUE WHERE meeting_id=$1 AND user_id=$2`,
      [meeting.id, req.params.userId]
    );
    res.json({ status: 'muted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mute participant' });
  }
});

// ── POST /:id/end — Host ends meeting ────────────────────────────
router.post('/:id/end', mw, async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const roleRes = await query(
      `SELECT role FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [meeting.id, req.user.id]
    );
    const myRole = roleRes.rows[0]?.role;
    if (meeting.host_id !== req.user.id && myRole !== 'co_host')
      return res.status(403).json({ error: 'Only host or co-host can end the meeting' });

    await query(
      `UPDATE meetings SET status='ended', ended_at=NOW() WHERE id=$1`,
      [meeting.id]
    );
    await query(
      `UPDATE meeting_participants SET left_at=NOW() WHERE meeting_id=$1 AND left_at IS NULL`,
      [meeting.id]
    );
    res.json({ status: 'ended' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

// ── GET /:id/participants — List active participants ───────────────
router.get('/:id/participants', mw, async (req, res) => {
  try {
    const participants = await activeParticipants(req.params.id);
    res.json(participants);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// ── POST /:id/transfer-host/:userId — Transfer host role ──────────
router.post('/:id/transfer-host/:userId', mw, async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.host_id !== req.user.id)
      return res.status(403).json({ error: 'Only the current host can transfer host role' });

    const targetId = req.params.userId;
    if (targetId === req.user.id)
      return res.status(400).json({ error: 'Cannot transfer host to yourself' });

    // Verify target is an active participant
    const targetCheck = await query(
      `SELECT * FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,
      [meeting.id, targetId]
    );
    if (!targetCheck.rows.length)
      return res.status(404).json({ error: 'User is not in the meeting' });

    // Transfer: new host_id in meetings table
    await query(`UPDATE meetings SET host_id=$1 WHERE id=$2`, [targetId, meeting.id]);
    // New host gets host role
    await query(
      `UPDATE meeting_participants SET role='host' WHERE meeting_id=$1 AND user_id=$2`,
      [meeting.id, targetId]
    );
    // Old host becomes co_host (stays in meeting)
    await query(
      `UPDATE meeting_participants SET role='co_host' WHERE meeting_id=$1 AND user_id=$2`,
      [meeting.id, req.user.id]
    );

    res.json({ status: 'transferred', new_host_id: targetId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to transfer host' });
  }
});

module.exports = router;
