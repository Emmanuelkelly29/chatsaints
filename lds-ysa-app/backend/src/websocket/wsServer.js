'use strict';
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { getRedisClient, keys } = require('../config/redis');
const { isMissionaryLocked } = require('../utils/accessControl');
const { notifyConversationMembers, notifyIncomingCall } = require('../services/notificationService');

// Map: userId -> Set<WebSocket>
const userSockets = new Map();

const getOnlineUserIds = () => new Set(userSockets.keys());

const getUserFromToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      `SELECT id, full_name, role, status, stake_id, mission_id,
              missionary_mode_active, mission_president_mission_id
       FROM users WHERE id = $1 AND status != 'suspended'`,
      [decoded.userId]
    );
    return result.rows[0] || null;
  } catch { return null; }
};

const broadcast = (userId, data) => {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(data);
  sockets.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(payload); });
};

const broadcastToConversation = async (conversationId, data, excludeUserId = null) => {
  const result = await query(
    'SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND left_at IS NULL',
    [conversationId]
  );
  result.rows.forEach(row => { if (row.user_id !== excludeUserId) broadcast(row.user_id, data); });
};

const setUserOnline = async (userId, online) => {
  try {
    const redis = await getRedisClient();
    if (online) await redis.setEx(keys.userOnline(userId), 90, '1');
    else await redis.del(keys.userOnline(userId));
    await query('UPDATE users SET last_seen = NOW() WHERE id = $1', [userId]);
  } catch (err) { console.error('Redis online error:', err.message); }
};

const handleMessage = async (ws, user, rawData) => {
  let msg;
  try { msg = JSON.parse(rawData); } catch { return; }
  const { type, payload } = msg;

  switch (type) {

    case 'ping': {
      await setUserOnline(user.id, true);
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }

    case 'send_message': {
      const { conversation_id, content, message_type = 'text', reply_to_message_id, media_url } = payload;

      // Verify membership
      const member = await query(
        'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
        [conversation_id, user.id]
      );
      if (!member.rows.length) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Not a member of this conversation' } }));
        return;
      }

      // Missionary scope check
      if (isMissionaryLocked(user)) {
        const conv = await query('SELECT mission_id FROM conversations WHERE id=$1', [conversation_id]);
        if (!conv.rows[0]?.mission_id || conv.rows[0].mission_id !== user.mission_id) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Missionaries can only message within their mission' } }));
          return;
        }
      }

      const msgId = uuidv4();
      await query(
        `INSERT INTO messages (id, conversation_id, sender_id, type, content, media_url, reply_to_message_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [msgId, conversation_id, user.id, message_type, content || null, media_url || null, reply_to_message_id || null]
      );
      await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversation_id]);

      const newMsg = {
        id: msgId, conversation_id,
        sender_id: user.id, sender_name: user.full_name,
        type: message_type, content, media_url: media_url || null,
        created_at: new Date().toISOString(),
        reply_to_message_id: reply_to_message_id || null,
      };

      // Deliver in real-time to connected members
      await broadcastToConversation(conversation_id, { type: 'new_message', payload: newMsg });

      // Push notifications to offline members
      await notifyConversationMembers(
        conversation_id, user.id, user.full_name,
        content || (message_type !== 'text' ? `sent a ${message_type}` : ''),
        getOnlineUserIds()
      );
      break;
    }

    case 'typing': {
      const { conversation_id } = payload;
      await broadcastToConversation(conversation_id,
        { type: 'user_typing', payload: { user_id: user.id, user_name: user.full_name, conversation_id } },
        user.id
      );
      break;
    }

    case 'stop_typing': {
      const { conversation_id } = payload;
      await broadcastToConversation(conversation_id,
        { type: 'user_stop_typing', payload: { user_id: user.id, conversation_id } },
        user.id
      );
      break;
    }

    case 'mark_read': {
      const { message_id } = payload;
      await query(
        `INSERT INTO message_reads (id, message_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [uuidv4(), message_id, user.id]
      );
      const msgResult = await query(
        'SELECT sender_id, conversation_id FROM messages WHERE id = $1', [message_id]
      );
      if (msgResult.rows.length) {
        const { sender_id, conversation_id } = msgResult.rows[0];
        broadcast(sender_id, { type: 'message_read', payload: { message_id, reader_id: user.id, conversation_id } });
      }
      break;
    }

    // ── WebRTC Signalling ──────────────────────────────────────

    case 'initiate_call': {
      const { conversation_id, call_type } = payload;
      const callId = uuidv4();
      await query(
        `INSERT INTO calls (id, conversation_id, initiated_by, type, status, started_at)
         VALUES ($1,$2,$3,$4,'initiated', NOW())`,
        [callId, conversation_id, user.id, call_type]
      );

      // Get conversation members to call
      const members = await query(
        `SELECT user_id FROM conversation_members
         WHERE conversation_id=$1 AND left_at IS NULL AND user_id != $2`,
        [conversation_id, user.id]
      );

      members.rows.forEach(row => {
        // Real-time signal to online members
        broadcast(row.user_id, {
          type: 'incoming_call',
          payload: { call_id: callId, caller_id: user.id, caller_name: user.full_name, call_type, conversation_id },
        });
        // Push notification to offline members
        if (!getOnlineUserIds().has(row.user_id)) {
          notifyIncomingCall(row.user_id, user.full_name, call_type, callId, conversation_id);
        }
      });

      ws.send(JSON.stringify({ type: 'call_initiated', payload: { call_id: callId } }));
      break;
    }

    // WebRTC offer/answer/ICE candidate relay
    case 'webrtc_offer':
    case 'webrtc_answer':
    case 'webrtc_ice_candidate': {
      const { target_user_id, sdp, candidate, call_id } = payload;
      broadcast(target_user_id, {
        type,
        payload: { from_user_id: user.id, sdp, candidate, call_id },
      });
      break;
    }

    case 'call_accepted': {
      const { call_id, conversation_id } = payload;
      await query(`UPDATE calls SET status='answered' WHERE id=$1`, [call_id]);
      await broadcastToConversation(conversation_id,
        { type: 'call_accepted', payload: { call_id, accepted_by: user.id } }
      );
      break;
    }

    case 'call_declined': {
      const { call_id, conversation_id } = payload;
      await query(`UPDATE calls SET status='declined', ended_at=NOW() WHERE id=$1`, [call_id]);
      await broadcastToConversation(conversation_id,
        { type: 'call_declined', payload: { call_id, declined_by: user.id } }
      );
      break;
    }

    case 'end_call': {
      const { call_id, conversation_id } = payload;
      await query(
        `UPDATE calls SET status='ended', ended_at=NOW(),
         duration_secs=EXTRACT(EPOCH FROM(NOW()-started_at))::INTEGER
         WHERE id=$1`,
        [call_id]
      );
      await broadcastToConversation(conversation_id,
        { type: 'call_ended', payload: { call_id } }
      );
      break;
    }

    // ── Presence ──────────────────────────────────────────────

    case 'check_online': {
      const { user_ids } = payload;
      const onlineMap = {};
      for (const uid of (user_ids || [])) {
        onlineMap[uid] = userSockets.has(uid);
      }
      ws.send(JSON.stringify({ type: 'online_status', payload: onlineMap }));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', payload: { message: `Unknown type: ${type}` } }));
  }
};

const initWebSocketServer = (httpServer) => {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const url   = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) { ws.close(1008, 'Token required'); return; }

    const user = await getUserFromToken(token);
    if (!user) { ws.close(1008, 'Invalid token'); return; }

    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(ws);
    await setUserOnline(user.id, true);

    console.log(`WS connected: ${user.full_name} [${user.role}]`);
    ws.send(JSON.stringify({ type: 'connected', payload: { user_id: user.id } }));

    ws.on('message', (data) => handleMessage(ws, user, data));

    ws.on('close', async () => {
      userSockets.get(user.id)?.delete(ws);
      if (!userSockets.get(user.id)?.size) {
        userSockets.delete(user.id);
        await setUserOnline(user.id, false);
      }
      console.log(`WS disconnected: ${user.full_name}`);
    });

    ws.on('error', (err) => console.error(`WS error ${user.id}:`, err.message));
  });

  console.log('WebSocket server ready at /ws');
  return wss;
};

module.exports = { initWebSocketServer, broadcast, getOnlineUserIds };
