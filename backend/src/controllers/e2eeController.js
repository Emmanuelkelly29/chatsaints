'use strict';
const {
  registerKeyBundle, fetchKeyBundle, getOTPKCount,
  addOneTimePreKeys, drainMessageQueue,
} = require('../services/encryptionService');

// POST /api/e2ee/keys — register or update key bundle (called on first login)
const registerKeys = async (req, res) => {
  try {
    const result = await registerKeyBundle(req.user.id, req.body);
    return res.json(result);
  } catch (err) {
    console.error('registerKeys error:', err);
    return res.status(500).json({ error: 'Failed to register keys' });
  }
};

// GET /api/e2ee/keys/:userId — fetch a recipient's public key bundle to start a session
const getKeys = async (req, res) => {
  try {
    const bundle = await fetchKeyBundle(req.params.userId);
    if (!bundle) {
      return res.status(404).json({
        error: 'No E2EE keys found for this user. They may need to update their app.',
      });
    }
    return res.json(bundle);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch key bundle' });
  }
};

// GET /api/e2ee/keys/status — how many one-time prekeys remain (client monitors this)
const getKeyStatus = async (req, res) => {
  try {
    const count = await getOTPKCount(req.user.id);
    return res.json({
      one_time_prekeys_remaining: count,
      needs_replenishment: count < 10,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed' });
  }
};

// POST /api/e2ee/keys/prekeys — upload more one-time prekeys when supply is low
const uploadPreKeys = async (req, res) => {
  try {
    const { one_time_prekeys } = req.body;
    if (!Array.isArray(one_time_prekeys) || !one_time_prekeys.length) {
      return res.status(400).json({ error: 'one_time_prekeys array required' });
    }
    const result = await addOneTimePreKeys(req.user.id, one_time_prekeys);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to upload prekeys' });
  }
};

// GET /api/e2ee/queue — drain offline message queue on reconnect
const drainQueue = async (req, res) => {
  try {
    const messages = await drainMessageQueue(req.user.id);
    return res.json({ messages });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to drain queue' });
  }
};

module.exports = { registerKeys, getKeys, getKeyStatus, uploadPreKeys, drainQueue };
