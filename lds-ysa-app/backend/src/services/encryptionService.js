'use strict';
/**
 * END-TO-END ENCRYPTION SERVICE — Signal Protocol
 *
 * Architecture:
 *  - The Signal Protocol provides E2EE where ONLY sender and receiver can read messages.
 *  - The server stores and routes encrypted ciphertext — it cannot decrypt messages.
 *  - Key exchange (X3DH) and ratcheting happen on-device via the Flutter signal_protocol_dart package.
 *  - This server-side service handles:
 *    1. Key registration — storing users' public identity/signed/one-time prekeys
 *    2. Key fetching — providing recipient's public keys to senders
 *    3. Key rotation — managing one-time prekey replenishment
 *
 * Client-side (Flutter) handles:
 *    - Generating key pairs (identity, signed prekey, one-time prekeys)
 *    - X3DH key agreement when starting a session
 *    - Double Ratchet encryption/decryption of messages
 *    - Session state persistence in encrypted local storage
 *
 * Setup (production):
 *    npm install libsignal-protocol  (already installed)
 *    Use signal_protocol_dart on Flutter side
 */

const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// ── Database helpers ─────────────────────────────────────────────
// These tables need to be added via migration 004 (see database/migrations/004_e2ee.sql)

/**
 * Store a user's public key bundle (called on first login or key rotation).
 * Body contains all public keys — the server NEVER sees private keys.
 */
const registerKeyBundle = async (userId, keyBundle) => {
  const {
    registrationId,
    identityKey,        // public identity key (base64)
    signedPreKey,       // { keyId, publicKey, signature }
    oneTimePreKeys,     // array of { keyId, publicKey }
  } = keyBundle;

  // Store identity key
  await query(
    `INSERT INTO e2ee_identity_keys (user_id, registration_id, identity_key_public)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
     SET identity_key_public=$3, registration_id=$2, updated_at=NOW()`,
    [userId, registrationId, identityKey]
  );

  // Store signed prekey
  await query(
    `INSERT INTO e2ee_signed_prekeys (user_id, key_id, public_key, signature)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, key_id) DO UPDATE SET public_key=$3, signature=$4`,
    [userId, signedPreKey.keyId, signedPreKey.publicKey, signedPreKey.signature]
  );

  // Store one-time prekeys (batch insert)
  for (const opk of (oneTimePreKeys || [])) {
    await query(
      `INSERT INTO e2ee_one_time_prekeys (id, user_id, key_id, public_key, used)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (user_id, key_id) DO NOTHING`,
      [uuidv4(), userId, opk.keyId, opk.publicKey]
    );
  }

  return { registered: true };
};

/**
 * Fetch a recipient's key bundle so the sender can initiate an X3DH session.
 * Consumes one one-time prekey (marks it used — single use by design).
 */
const fetchKeyBundle = async (recipientId) => {
  // Identity key
  const identityResult = await query(
    `SELECT identity_key_public, registration_id
     FROM e2ee_identity_keys WHERE user_id=$1`,
    [recipientId]
  );
  if (!identityResult.rows.length) {
    return null; // User has not registered keys yet
  }

  // Latest signed prekey
  const signedResult = await query(
    `SELECT key_id, public_key, signature
     FROM e2ee_signed_prekeys WHERE user_id=$1
     ORDER BY key_id DESC LIMIT 1`,
    [recipientId]
  );

  // Consume one one-time prekey (mark used atomically)
  const otpkResult = await query(
    `UPDATE e2ee_one_time_prekeys
     SET used=true
     WHERE id = (
       SELECT id FROM e2ee_one_time_prekeys
       WHERE user_id=$1 AND used=false
       ORDER BY key_id ASC LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING key_id, public_key`,
    [recipientId]
  );

  const identity   = identityResult.rows[0];
  const signedPK   = signedResult.rows[0];
  const oneTimePK  = otpkResult.rows[0] || null;

  return {
    registrationId:   identity.registration_id,
    identityKey:      identity.identity_key_public,
    signedPreKey:     signedPK ? {
      keyId:      signedPK.key_id,
      publicKey:  signedPK.public_key,
      signature:  signedPK.signature,
    } : null,
    oneTimePreKey: oneTimePK ? {
      keyId:     oneTimePK.key_id,
      publicKey: oneTimePK.public_key,
    } : null,
  };
};

/**
 * Check how many one-time prekeys a user has remaining.
 * The client should replenish when this drops below 10.
 */
const getOTPKCount = async (userId) => {
  const result = await query(
    `SELECT COUNT(*) FROM e2ee_one_time_prekeys WHERE user_id=$1 AND used=false`,
    [userId]
  );
  return parseInt(result.rows[0].count);
};

/**
 * Add more one-time prekeys (called by client when supply runs low).
 */
const addOneTimePreKeys = async (userId, oneTimePreKeys) => {
  for (const opk of oneTimePreKeys) {
    await query(
      `INSERT INTO e2ee_one_time_prekeys (id, user_id, key_id, public_key, used)
       VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING`,
      [uuidv4(), userId, opk.keyId, opk.publicKey]
    );
  }
  return { added: oneTimePreKeys.length };
};

/**
 * Store an encrypted message payload.
 * The server stores the ciphertext but CANNOT decrypt it.
 * Used for sealed-sender delivery when recipient is offline.
 */
const storeEncryptedMessage = async (senderId, recipientId, encryptedPayload) => {
  await query(
    `INSERT INTO e2ee_message_queue (id, sender_id, recipient_id, ciphertext, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [uuidv4(), senderId, recipientId, encryptedPayload]
  );
};

/**
 * Retrieve and clear queued encrypted messages for a user (on reconnect).
 */
const drainMessageQueue = async (userId) => {
  const result = await query(
    `DELETE FROM e2ee_message_queue WHERE recipient_id=$1
     RETURNING id, sender_id, ciphertext, created_at`,
    [userId]
  );
  return result.rows;
};

module.exports = {
  registerKeyBundle,
  fetchKeyBundle,
  getOTPKCount,
  addOneTimePreKeys,
  storeEncryptedMessage,
  drainMessageQueue,
};
