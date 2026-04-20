'use strict';
/**
 * GROUP VIDEO CALL CONTROLLER (LiveKit integration)
 *
 * LiveKit is an open-source WebRTC media server that handles group
 * video calls with up to 1,000 participants. It handles all the
 * SFU (Selective Forwarding Unit) logic so your backend only needs
 * to create rooms and mint access tokens.
 *
 * Setup:
 *   1. Deploy LiveKit server: https://docs.livekit.io/oss/deployment/
 *      OR use LiveKit Cloud (free tier): https://cloud.livekit.io
 *   2. Add to .env:
 *      LIVEKIT_URL=wss://your-livekit-server.com
 *      LIVEKIT_API_KEY=your-api-key
 *      LIVEKIT_API_SECRET=your-api-secret
 *   3. npm install livekit-server-sdk
 */

const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { isMissionaryLocked } = require('../utils/accessControl');

// Try to import LiveKit SDK — graceful fallback if not installed
let AccessToken, RoomServiceClient;
try {
  const lk = require('livekit-server-sdk');
  AccessToken       = lk.AccessToken;
  RoomServiceClient = lk.RoomServiceClient;
} catch {
  console.warn('livekit-server-sdk not installed. Run: npm install livekit-server-sdk');
}

const getLiveKitToken = (roomName, participantName, participantId) => {
  const apiKey    = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!AccessToken || !apiKey || !apiSecret) {
    // Return a mock token for development
    return `mock-livekit-token-${participantId}-${roomName}`;
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantId,
    name: participantName,
    ttl: 3600, // 1 hour
  });

  at.addGrant({
    roomJoin:     true,
    room:         roomName,
    canPublish:   true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
};

// POST /api/video/rooms — create or join a video room for a conversation
const createOrJoinRoom = async (req, res) => {
  try {
    const user = req.user;
    const { conversation_id, max_participants = 50 } = req.body;

    if (!conversation_id) {
      return res.status(400).json({ error: 'conversation_id is required' });
    }

    // Verify membership in conversation
    const memberCheck = await query(
      'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
      [conversation_id, user.id]
    );
    if (!memberCheck.rows.length) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    // Missionary scope check
    if (isMissionaryLocked(user)) {
      const conv = await query('SELECT mission_id FROM conversations WHERE id=$1', [conversation_id]);
      if (!conv.rows[0]?.mission_id || conv.rows[0].mission_id !== user.mission_id) {
        return res.status(403).json({ error: 'Missionaries can only join mission-scoped video calls' });
      }
    }

    // Find existing active room for this conversation, or create one
    let room = null;
    const existingRoom = await query(
      `SELECT * FROM video_rooms WHERE conversation_id=$1 AND is_active=true LIMIT 1`,
      [conversation_id]
    );

    if (existingRoom.rows.length) {
      room = existingRoom.rows[0];
    } else {
      const roomName = `room-${conversation_id}-${Date.now()}`;
      const roomId   = uuidv4();

      await query(
        `INSERT INTO video_rooms (id, conversation_id, room_name, created_by, max_participants, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [roomId, conversation_id, roomName, user.id, max_participants]
      );

      room = { id: roomId, room_name: roomName };

      // Notify all conversation members that a video call started
      // (handled by WebSocket wsServer.js initiate_call event)
    }

    // Record participant joining
    await query(
      `INSERT INTO video_room_participants (id, room_id, user_id, joined_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (room_id, user_id) DO UPDATE SET joined_at=NOW(), left_at=NULL`,
      [uuidv4(), room.id, user.id]
    );

    // Mint a LiveKit access token for this participant
    const token = getLiveKitToken(room.room_name, user.full_name, user.id);

    return res.json({
      room_id:         room.id,
      room_name:       room.room_name,
      livekit_url:     process.env.LIVEKIT_URL || 'wss://your-livekit-server.com',
      token,
      is_mock:         !process.env.LIVEKIT_API_KEY,
      message: process.env.LIVEKIT_API_KEY
        ? 'Joined room. Use the token and URL to connect via LiveKit SDK.'
        : 'Development mode — set LIVEKIT_* env vars for real video calls.',
    });
  } catch (err) {
    console.error('createOrJoinRoom error:', err);
    return res.status(500).json({ error: 'Failed to create video room' });
  }
};

// POST /api/video/rooms/:roomId/leave
const leaveRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    await query(
      'UPDATE video_room_participants SET left_at=NOW() WHERE room_id=$1 AND user_id=$2',
      [roomId, req.user.id]
    );

    // Check if any participants remain
    const remaining = await query(
      'SELECT COUNT(*) FROM video_room_participants WHERE room_id=$1 AND left_at IS NULL',
      [roomId]
    );

    // If no one left, close the room
    if (parseInt(remaining.rows[0].count) === 0) {
      await query(
        'UPDATE video_rooms SET is_active=false, ended_at=NOW() WHERE id=$1',
        [roomId]
      );
    }

    return res.json({ message: 'Left the video room' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to leave room' });
  }
};

// GET /api/video/rooms/:conversationId/active — check if a room is active
const getActiveRoom = async (req, res) => {
  try {
    const result = await query(
      `SELECT vr.id, vr.room_name, vr.created_at,
              (SELECT COUNT(*) FROM video_room_participants
               WHERE room_id=vr.id AND left_at IS NULL) as participant_count
       FROM video_rooms vr
       WHERE vr.conversation_id=$1 AND vr.is_active=true LIMIT 1`,
      [req.params.conversationId]
    );

    if (!result.rows.length) {
      return res.json({ active: false });
    }

    return res.json({ active: true, room: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

module.exports = { createOrJoinRoom, leaveRoom, getActiveRoom };
