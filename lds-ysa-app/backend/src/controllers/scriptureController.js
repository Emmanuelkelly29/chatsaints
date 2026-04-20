'use strict';
const { query } = require('../config/database');
const { getRedisClient, keys } = require('../config/redis');

// GET /api/scriptures/current — returns current rotating scripture
const getCurrentScripture = async (req, res) => {
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(keys.scriptureCurrent());
    if (cached) return res.json(JSON.parse(cached));

    // Pick random scripture from DB
    const result = await query(
      'SELECT * FROM scriptures ORDER BY RANDOM() LIMIT 1', []);
    if (!result.rows.length) return res.status(404).json({ error: 'No scriptures found' });

    const scripture = result.rows[0];
    const ttlSeconds = (parseInt(process.env.SCRIPTURE_ROTATE_MINS) || 5) * 60;
    await redis.setEx(keys.scriptureCurrent(), ttlSeconds, JSON.stringify(scripture));

    return res.json(scripture);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch scripture' });
  }
};

// GET /api/scriptures/random — always fresh random
const getRandomScripture = async (req, res) => {
  try {
    const { volume } = req.query;
    const result = await query(
      `SELECT * FROM scriptures ${volume ? 'WHERE volume=$1' : ''} ORDER BY RANDOM() LIMIT 1`,
      volume ? [volume] : []
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No scriptures found' });
    return res.json(result.rows[0]);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

module.exports = { getCurrentScripture, getRandomScripture };
