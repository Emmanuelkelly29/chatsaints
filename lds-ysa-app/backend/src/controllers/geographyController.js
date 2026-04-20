'use strict';
const { query } = require('../config/database');

// GET /api/geography/areas
const getAreas = async (req, res) => {
  try {
    const result = await query('SELECT id, name, continent FROM areas ORDER BY continent, name');
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// GET /api/geography/stakes?area_id=&country=
const getStakes = async (req, res) => {
  try {
    const { area_id, country } = req.query;
    const result = await query(
      `SELECT s.id, s.name, s.country, s.ysa_pool_active,
              cc.name as coordinating_council_name, a.name as area_name
       FROM stakes s
       JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       JOIN areas a ON cc.area_id = a.id
       WHERE ($1::uuid IS NULL OR a.id = $1)
         AND ($2::text IS NULL OR s.country ILIKE $2)
       ORDER BY s.country, s.name`,
      [area_id || null, country ? `%${country}%` : null]
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// GET /api/geography/missions?area_id=
const getMissions = async (req, res) => {
  try {
    const { area_id } = req.query;
    const result = await query(
      `SELECT m.id, m.name, m.country, a.name as area_name
       FROM missions m
       LEFT JOIN areas a ON m.area_id = a.id
       WHERE ($1::uuid IS NULL OR m.area_id = $1)
       ORDER BY m.country, m.name`,
      [area_id || null]
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// GET /api/geography/districts?area_id=
const getDistricts = async (req, res) => {
  try {
    const { area_id } = req.query;
    const result = await query(
      `SELECT d.id, d.name, d.country, cc.name as coordinating_council_name
       FROM districts d
       JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
       WHERE ($1::uuid IS NULL OR cc.area_id = $1)
       ORDER BY d.country, d.name`,
      [area_id || null]
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

module.exports = { getAreas, getStakes, getMissions, getDistricts };
