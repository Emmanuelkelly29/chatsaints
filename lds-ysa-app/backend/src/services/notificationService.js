'use strict';
/**
 * PUSH NOTIFICATION SERVICE
 * Handles FCM (Android) and APNs (iOS) push notifications.
 * Sends alerts when users receive messages, calls, or status updates
 * while they are offline or in background.
 *
 * FCM setup: set FIREBASE_SERVICE_ACCOUNT_PATH in .env to the path of your
 * Firebase service account JSON file (download from Firebase Console →
 * Project Settings → Service accounts → Generate new private key).
 */

const path = require('path');
const { query } = require('../config/database');

// ── Firebase Admin SDK init (FCM HTTP v1) ───────────────────────
let firebaseApp = null;

const getFirebaseApp = () => {
  if (firebaseApp) return firebaseApp;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) {
      firebaseApp = admin.apps[0];
      return firebaseApp;
    }
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!serviceAccountPath) return null;
    // Resolve relative to project root (cwd = backend/ when server starts)
    const absolutePath = path.resolve(process.cwd(), serviceAccountPath);
    // eslint-disable-next-line import/no-dynamic-require
    const serviceAccount = require(absolutePath);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return firebaseApp;
  } catch (err) {
    console.warn('Firebase Admin not initialised (FCM disabled):', err.message);
    return null;
  }
};

// ── FCM (Firebase Cloud Messaging) — Android / cross-platform ───

const sendFCM = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return;
  const app = getFirebaseApp();
  if (!app) return; // Firebase not configured yet

  try {
    const admin = require('firebase-admin');
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );
    const response = await admin.messaging(app).send({
      token: fcmToken,
      notification: { title, body },
      data: stringData,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });
    return response;
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
};

// ── APNs (Apple Push Notification service) — iOS ─────────────────
// FCM HTTP v1 handles APNs delivery when using firebase-admin.
// For direct APNs (without Firebase), use the 'apn' npm package with your .p8 key.

const sendAPNs = async (apnsToken, title, body, data = {}) => {
  // When firebase-admin is configured, FCM v1 handles both Android and iOS.
  // Direct APNs is only needed if you bypass Firebase for iOS.
  if (!process.env.APNS_KEY_ID || !apnsToken) return;
  console.log('APNs: direct delivery not yet implemented — using FCM for iOS.');
};

// ── High-level notification helpers ─────────────────────────────

/**
 * Notify a user about a new message when they are offline.
 */
const notifyNewMessage = async (recipientId, senderName, messagePreview, conversationId) => {
  try {
    const result = await query(
      'SELECT fcm_token, apns_token FROM users WHERE id = $1',
      [recipientId]
    );
    if (!result.rows.length) return;
    const { fcm_token, apns_token } = result.rows[0];

    const title = senderName;
    const body  = messagePreview.length > 80
      ? messagePreview.substring(0, 80) + '…'
      : messagePreview;
    const data  = { type: 'new_message', conversation_id: conversationId };

    await Promise.all([
      sendFCM(fcm_token, title, body, data),
      sendAPNs(apns_token, title, body, data),
    ]);
  } catch (err) {
    console.error('notifyNewMessage error:', err.message);
  }
};

/**
 * Notify a user about an incoming call.
 */
const notifyIncomingCall = async (recipientId, callerName, callType, callId, conversationId) => {
  try {
    const result = await query(
      'SELECT fcm_token, apns_token FROM users WHERE id = $1',
      [recipientId]
    );
    if (!result.rows.length) return;
    const { fcm_token, apns_token } = result.rows[0];

    const title = `Incoming ${callType} call`;
    const body  = `${callerName} is calling you`;
    const data  = { type: 'incoming_call', call_id: callId, conversation_id: conversationId, call_type: callType };

    await Promise.all([
      sendFCM(fcm_token, title, body, data),
      sendAPNs(apns_token, title, body, data),
    ]);
  } catch (err) {
    console.error('notifyIncomingCall error:', err.message);
  }
};

/**
 * Notify a user about a new status from someone they follow.
 */
const notifyNewStatus = async (recipientId, authorName) => {
  try {
    const result = await query(
      'SELECT fcm_token, apns_token FROM users WHERE id = $1',
      [recipientId]
    );
    if (!result.rows.length) return;
    const { fcm_token, apns_token } = result.rows[0];

    const title = 'New status update';
    const body  = `${authorName} posted a new status`;
    const data  = { type: 'new_status' };

    await Promise.all([
      sendFCM(fcm_token, title, body, data),
      sendAPNs(apns_token, title, body, data),
    ]);
  } catch (err) {
    console.error('notifyNewStatus error:', err.message);
  }
};

/**
 * Notify all members of a conversation about a new message (except sender).
 * Only sends push to users who are NOT currently connected via WebSocket.
 */
const notifyConversationMembers = async (conversationId, senderId, senderName, messageContent, onlineUserIds = new Set()) => {
  try {
    const result = await query(
      `SELECT user_id FROM conversation_members
       WHERE conversation_id = $1 AND left_at IS NULL AND user_id != $2`,
      [conversationId, senderId]
    );

    const preview = messageContent || 'sent a message';

    await Promise.all(
      result.rows
        .filter(row => !onlineUserIds.has(row.user_id))
        .map(row => notifyNewMessage(row.user_id, senderName, preview, conversationId))
    );
  } catch (err) {
    console.error('notifyConversationMembers error:', err.message);
  }
};

/**
 * Notify a leader when a new account needs their approval.
 */
const notifyLeaderApprovalNeeded = async (applicantName, declaredRole) => {
  try {
    // Find all leaders who can approve this role
    const { ROLE_TIER } = require('../utils/accessControl');
    const requiredTier = ROLE_TIER[declaredRole] || 0;

    const result = await query(
      `SELECT fcm_token, apns_token FROM users
       WHERE is_approved = true AND status = 'active'
         AND CASE role
           WHEN 'ysa_rep' THEN 2
           WHEN 'bishop' THEN 3
           WHEN 'stake_presidency' THEN 4
           WHEN 'coordinating_council' THEN 5
           WHEN 'area_authority' THEN 6
           WHEN 'area_presidency' THEN 7
           WHEN 'general_authority' THEN 8
           ELSE 0
         END >= $1`,
      [requiredTier]
    );

    const title = 'New leader approval needed';
    const body  = `${applicantName} has applied to be a ${declaredRole.replace(/_/g, ' ')}`;
    const data  = { type: 'leader_approval' };

    await Promise.all(
      result.rows.map(row => Promise.all([
        sendFCM(row.fcm_token, title, body, data),
        sendAPNs(row.apns_token, title, body, data),
      ]))
    );
  } catch (err) {
    console.error('notifyLeaderApprovalNeeded error:', err.message);
  }
};

module.exports = {
  sendFCM,
  sendAPNs,
  notifyNewMessage,
  notifyIncomingCall,
  notifyNewStatus,
  notifyConversationMembers,
  notifyLeaderApprovalNeeded,
};
