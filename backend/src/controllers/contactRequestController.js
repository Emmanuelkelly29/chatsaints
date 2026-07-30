'use strict';

const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { canReceiveContactRequest, canChat1on1 } = require('../utils/accessControl');
const {
  findExisting1on1Conversation,
  get1on1ConversationPayload,
  create1on1Conversation,
  findContactConnection,
  getUserChatSummary,
} = require('./conversationController');

const sortUserPair = (firstId, secondId) =>
  [firstId, secondId].sort((left, right) => left.localeCompare(right));

const listContactRequests = async (req, res) => {
  try {
    const [incoming, outgoing] = await Promise.all([
      query(
        `SELECT cr.id, cr.intro_message, cr.created_at,
                u.id as user_id, u.full_name, u.role, u.profile_photo_url,
                s.name as stake_name
         FROM contact_requests cr
         JOIN users u ON u.id = cr.sender_id
         LEFT JOIN stakes s ON s.id = u.stake_id
         WHERE cr.recipient_id = $1 AND cr.status = 'pending'
         ORDER BY cr.created_at DESC`,
        [req.user.id]
      ),
      query(
        `SELECT cr.id, cr.intro_message, cr.created_at,
                u.id as user_id, u.full_name, u.role, u.profile_photo_url,
                s.name as stake_name
         FROM contact_requests cr
         JOIN users u ON u.id = cr.recipient_id
         LEFT JOIN stakes s ON s.id = u.stake_id
         WHERE cr.sender_id = $1 AND cr.status = 'pending'
         ORDER BY cr.created_at DESC`,
        [req.user.id]
      ),
    ]);

    return res.json({
      incoming: incoming.rows,
      outgoing: outgoing.rows,
      incoming_count: incoming.rows.length,
      outgoing_count: outgoing.rows.length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load contact requests' });
  }
};

const createContactRequest = async (req, res) => {
  try {
    const { target_user_id, intro_message } = req.body;
    const sender = req.user;

    if (!target_user_id) return res.status(400).json({ error: 'target_user_id is required' });
    if (target_user_id === sender.id) return res.status(400).json({ error: 'Cannot send a request to yourself' });

    const recipient = await getUserChatSummary(target_user_id);
    if (!recipient) return res.status(404).json({ error: 'User not found' });
    if (!recipient.is_approved) return res.status(403).json({ error: 'This user cannot receive requests yet' });
    if (recipient.directory_visible === false) {
      return res.status(403).json({ error: 'This user is not available for new requests' });
    }
    if (!canChat1on1(sender, recipient)) {
      return res.status(403).json({ error: 'You cannot connect with this user' });
    }

    const connection = await findContactConnection(sender.id, recipient.id);
    if (connection.rows.length) {
      return res.json({ status: 'connected', message: 'You are already connected' });
    }

    if (!canReceiveContactRequest(sender, recipient, recipient.contact_request_preference)) {
      return res.status(403).json({ error: 'This user is not accepting connection requests from you' });
    }

    const reversePending = await query(
      `SELECT id FROM contact_requests
       WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending'
       LIMIT 1`,
      [recipient.id, sender.id]
    );
    if (reversePending.rows.length) {
      return res.status(409).json({
        error: 'This user has already sent you a request. Accept it from your requests inbox.',
        request_status: 'incoming_pending',
        request_id: reversePending.rows[0].id,
      });
    }

    const existing = await query(
      `SELECT id, status FROM contact_requests
       WHERE sender_id = $1 AND recipient_id = $2
       LIMIT 1`,
      [sender.id, recipient.id]
    );

    let requestRow;
    if (existing.rows.length) {
      requestRow = (await query(
        `UPDATE contact_requests
         SET intro_message = $1,
             status = 'pending',
             created_at = NOW(),
             responded_at = NULL,
             conversation_id = NULL
         WHERE id = $2
         RETURNING id, status, created_at`,
        [intro_message?.trim() || null, existing.rows[0].id]
      )).rows[0];
    } else {
      requestRow = (await query(
        `INSERT INTO contact_requests (id, sender_id, recipient_id, intro_message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, status, created_at`,
        [uuidv4(), sender.id, recipient.id, intro_message?.trim() || null]
      )).rows[0];
    }

    return res.status(201).json({
      message: 'Connection request sent',
      request: requestRow,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send connection request' });
  }
};

const acceptContactRequest = async (req, res) => {
  try {
    const requestId = req.params.id;
    const receiverId = req.user.id;

    const requestResult = await query(
      `SELECT id, sender_id, recipient_id, status
       FROM contact_requests
       WHERE id = $1 AND recipient_id = $2
       LIMIT 1`,
      [requestId, receiverId]
    );

    if (!requestResult.rows.length) return res.status(404).json({ error: 'Request not found' });
    const contactRequest = requestResult.rows[0];
    if (contactRequest.status !== 'pending') {
      return res.status(400).json({ error: 'This request is no longer pending' });
    }

    const sender = await getUserChatSummary(contactRequest.sender_id);
    if (!sender || !canChat1on1(sender, req.user)) {
      return res.status(403).json({ error: 'This request can no longer be accepted' });
    }

    const [lowId, highId] = sortUserPair(contactRequest.sender_id, receiverId);
    await query(
      `INSERT INTO contact_connections (id, user_low_id, user_high_id, request_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_low_id, user_high_id) DO NOTHING`,
      [uuidv4(), lowId, highId, contactRequest.id]
    );

    const existingConversation = await findExisting1on1Conversation(receiverId, contactRequest.sender_id);
    const conversationId = existingConversation.rows.length
      ? existingConversation.rows[0].id
      : await create1on1Conversation(receiverId, contactRequest.sender_id);

    await query(
      `UPDATE contact_requests
       SET status = 'accepted', responded_at = NOW(), conversation_id = $1
       WHERE id = $2`,
      [conversationId, contactRequest.id]
    );

    // Send automated system message to the conversation so sender sees acceptance
    const acceptorName = req.user.full_name || 'Someone';
    await query(
      `INSERT INTO messages (id, conversation_id, sender_id, type, content)
       VALUES (gen_random_uuid(), $1, $2, 'text', $3)`,
      [
        conversationId,
        receiverId,
        `✅ ${acceptorName} accepted your connection request. You can now chat!`,
      ]
    );

    const conversation = await get1on1ConversationPayload(conversationId, contactRequest.sender_id);
    return res.json({
      message: 'Connection accepted',
      conversation,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to accept connection request' });
  }
};

const declineContactRequest = async (req, res) => {
  try {
    const result = await query(
      `UPDATE contact_requests
       SET status = 'declined', responded_at = NOW()
       WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Request not found' });
    return res.json({ message: 'Connection request declined' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to decline connection request' });
  }
};

module.exports = {
  listContactRequests,
  createContactRequest,
  acceptContactRequest,
  declineContactRequest,
};