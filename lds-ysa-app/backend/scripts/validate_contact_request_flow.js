'use strict';

require('dotenv').config();

const { pool } = require('../src/config/database');

async function login(phoneNumber, password) {
  const response = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: phoneNumber, password }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Login failed for ${phoneNumber}: ${body.error || response.status}`);
  }
  return body.token;
}

async function authedPost(token, path, body) {
  const response = await fetch(`http://localhost:4000/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function authedGet(token, path) {
  const response = await fetch(`http://localhost:4000/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function resetPair(userA, userB) {
  await pool.query(
    `DELETE FROM conversation_members
     WHERE conversation_id IN (
       SELECT c.id
       FROM conversations c
       JOIN conversation_members cm1 ON c.id = cm1.conversation_id AND cm1.user_id = $1
       JOIN conversation_members cm2 ON c.id = cm2.conversation_id AND cm2.user_id = $2
       WHERE c.is_group = false
     )`,
    [userA, userB]
  );
  await pool.query(
    `DELETE FROM conversations
     WHERE id IN (
       SELECT c.id
       FROM conversations c
       LEFT JOIN conversation_members cm ON c.id = cm.conversation_id
       WHERE c.is_group = false
       GROUP BY c.id
       HAVING COUNT(cm.id) = 0
     )`
  );
  await pool.query(
    `DELETE FROM contact_connections
     WHERE (user_low_id = LEAST($1::text, $2::text)::uuid AND user_high_id = GREATEST($1::text, $2::text)::uuid)
        OR (user_low_id = LEAST($2::text, $1::text)::uuid AND user_high_id = GREATEST($2::text, $1::text)::uuid)`,
    [userA, userB]
  );
  await pool.query(
    `DELETE FROM contact_requests
     WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)`,
    [userA, userB]
  );
}

async function main() {
  const firstUserId = 'b2000000-0000-0000-0000-000000000001';
  const secondUserId = 'b2000000-0000-0000-0000-000000000002';
  await resetPair(firstUserId, secondUserId);

  const senderToken = await login('+18015550101', 'Welcome123!');
  const recipientToken = await login('+18015550102', 'Welcome123!');

  const blockedDm = await authedPost(senderToken, '/conversations/1on1', {
    target_user_id: secondUserId,
  });

  const sentRequest = await authedPost(senderToken, '/contact-requests', {
    target_user_id: secondUserId,
    intro_message: 'Hi Noah, I would like to connect from the global YSA pool.',
  });

  const inbox = await authedGet(recipientToken, '/contact-requests');
  const requestId = inbox.body.incoming?.[0]?.id;
  if (!requestId) throw new Error('No incoming request found for recipient');

  const accepted = await authedPost(recipientToken, `/contact-requests/${requestId}/accept`, {});
  const unlockedDm = await authedPost(senderToken, '/conversations/1on1', {
    target_user_id: secondUserId,
  });

  console.log(JSON.stringify({
    blockedDmStatus: blockedDm.status,
    blockedDmRequiresRequest: blockedDm.body.requires_request ?? false,
    sendRequestStatus: sentRequest.status,
    inboxIncomingCount: inbox.body.incoming_count ?? 0,
    acceptStatus: accepted.status,
    unlockedDmStatus: unlockedDm.status,
    unlockedConversationId: unlockedDm.body.id ?? null,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });