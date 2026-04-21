'use strict';
const { v4: uuidv4 } = require('uuid');
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
       LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       LEFT JOIN areas a ON cc.area_id = a.id
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
       LEFT JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
       WHERE ($1::uuid IS NULL OR cc.area_id = $1)
       ORDER BY d.country, d.name`,
      [area_id || null]
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/geography/stakes — public; leaders register their stake (find-or-create)
const createStake = async (req, res) => {
  try {
    const { name, country } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const existing = await query(
      'SELECT id, name, country FROM stakes WHERE name ILIKE $1', [name.trim()]);
    if (existing.rows.length) return res.json(existing.rows[0]);
    const result = await query(
      'INSERT INTO stakes (id, name, country) VALUES ($1, $2, $3) RETURNING id, name, country',
      [uuidv4(), name.trim(), country?.trim() || null]);
    return res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Failed' }); }
};

// PATCH /api/geography/stakes/:id — admin/leader rename
const renameStake = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const result = await query(
      'UPDATE stakes SET name=$1 WHERE id=$2 RETURNING id, name, country',
      [name.trim(), req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Stake not found' });
    return res.json(result.rows[0]);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// DELETE /api/geography/stakes/:id — admin only
const deleteStake = async (req, res) => {
  try {
    await query('DELETE FROM stakes WHERE id=$1', [req.params.id]);
    return res.json({ message: 'Deleted' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/geography/districts — public; leaders register their district (find-or-create)
const createDistrict = async (req, res) => {
  try {
    const { name, country } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const existing = await query(
      'SELECT id, name, country FROM districts WHERE name ILIKE $1', [name.trim()]);
    if (existing.rows.length) return res.json(existing.rows[0]);
    const result = await query(
      'INSERT INTO districts (id, name, country) VALUES ($1, $2, $3) RETURNING id, name, country',
      [uuidv4(), name.trim(), country?.trim() || null]);
    return res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Failed' }); }
};

// PATCH /api/geography/districts/:id — admin/leader rename
const renameDistrict = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const result = await query(
      'UPDATE districts SET name=$1 WHERE id=$2 RETURNING id, name, country',
      [name.trim(), req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'District not found' });
    return res.json(result.rows[0]);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// DELETE /api/geography/districts/:id — admin only
const deleteDistrict = async (req, res) => {
  try {
    await query('DELETE FROM districts WHERE id=$1', [req.params.id]);
    return res.json({ message: 'Deleted' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

module.exports = { getAreas, getStakes, getMissions, getDistricts,
  createStake, renameStake, deleteStake,
  createDistrict, renameDistrict, deleteDistrict };
