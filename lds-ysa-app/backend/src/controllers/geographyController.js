'use strict';
const { v4: uuidv4 } = require('uuid');
const { query, getClient } = require('../config/database');

function normText(value) {
  return (value || '').toString().trim().replace(/\s+/g, ' ');
}

const isSafeIdent = (s) => /^[a-z_][a-z0-9_]*$/i.test(s);

async function deleteUnitWithDependencies(targetTable, id) {
  const fkRefs = await query(
    `SELECT tc.table_name, kcu.column_name, cols.is_nullable
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
     JOIN information_schema.columns cols
       ON cols.table_schema = tc.table_schema
      AND cols.table_name = tc.table_name
      AND cols.column_name = kcu.column_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'
       AND ccu.table_name = $1
       AND ccu.column_name = 'id'`,
    [targetTable]
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const ref of fkRefs.rows || []) {
      const refTable = ref.table_name;
      const refColumn = ref.column_name;
      const nullable = String(ref.is_nullable || '').toUpperCase() === 'YES';

      if (!isSafeIdent(refTable) || !isSafeIdent(refColumn)) continue;
      if (refTable === targetTable) continue;

      if (nullable) {
        await client.query(
          `UPDATE "${refTable}" SET "${refColumn}" = NULL WHERE "${refColumn}" = $1`,
          [id]
        );
      } else {
        await client.query(
          `DELETE FROM "${refTable}" WHERE "${refColumn}" = $1`,
          [id]
        );
      }
    }

    const deleted = await client.query(
      `DELETE FROM "${targetTable}" WHERE id = $1 RETURNING id, name, country`,
      [id]
    );

    await client.query('COMMIT');
    return deleted.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

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
      `SELECT s.id, s.name, s.country, s.continent, s.ysa_pool_active,
              cc.name as coordinating_council_name, a.name as area_name
       FROM stakes s
       LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       LEFT JOIN areas a ON cc.area_id = a.id
       WHERE ($1::uuid IS NULL OR a.id = $1)
         AND ($2::text IS NULL OR s.country ILIKE $2)
       ORDER BY s.continent, s.country, s.name`,
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
      `SELECT d.id, d.name, d.country, d.continent, cc.name as coordinating_council_name
       FROM districts d
       LEFT JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
       WHERE ($1::uuid IS NULL OR cc.area_id = $1)
       ORDER BY d.continent, d.country, d.name`,
      [area_id || null]
    );
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/geography/stakes — public; leaders register their stake (find-or-create)
const createStake = async (req, res) => {
  try {
    const { name, country, continent } = req.body;
    const normalizedName = normText(name);
    const normalizedCountry = normText(country);
    const normalizedContinent = normText(continent) || null;
    if (!normalizedName) return res.status(400).json({ error: 'name is required' });
    if (!normalizedCountry) return res.status(400).json({ error: 'country is required' });

    const exact = await query(
      `SELECT id, name, country, continent
       FROM stakes
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND LOWER(TRIM(COALESCE(country, ''))) = LOWER(TRIM($2))
       LIMIT 1`,
      [normalizedName, normalizedCountry]
    );
    if (exact.rows.length) {
      if (normalizedContinent && !exact.rows[0].continent) {
        const updated = await query(
          'UPDATE stakes SET continent = $1 WHERE id = $2 RETURNING id, name, country, continent',
          [normalizedContinent, exact.rows[0].id]
        );
        return res.json(updated.rows[0]);
      }
      return res.json(exact.rows[0]);
    }

    const byName = await query(
      `SELECT id, name, country, continent FROM stakes WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
      [normalizedName]
    );
    if (byName.rows.length === 1 && !byName.rows[0].country) {
      const merged = await query(
        'UPDATE stakes SET country = $1, continent = COALESCE($3, continent) WHERE id = $2 RETURNING id, name, country, continent',
        [normalizedCountry, byName.rows[0].id, normalizedContinent]
      );
      return res.json(merged.rows[0]);
    }

    const result = await query(
      'INSERT INTO stakes (id, name, country, continent) VALUES ($1, $2, $3, $4) RETURNING id, name, country, continent',
      [uuidv4(), normalizedName, normalizedCountry, normalizedContinent]);
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
    const deleted = await deleteUnitWithDependencies('stakes', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Stake not found' });
    return res.json({ message: 'Deleted', deleted });
  } catch (err) {
    console.error('deleteStake error:', err.message, err.code);
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
};

// POST /api/geography/districts — public; leaders register their district (find-or-create)
const createDistrict = async (req, res) => {
  try {
    const { name, country, continent } = req.body;
    const normalizedName = normText(name);
    const normalizedCountry = normText(country);
    const normalizedContinent = normText(continent) || null;
    if (!normalizedName) return res.status(400).json({ error: 'name is required' });
    if (!normalizedCountry) return res.status(400).json({ error: 'country is required' });

    const exact = await query(
      `SELECT id, name, country, continent
       FROM districts
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND LOWER(TRIM(COALESCE(country, ''))) = LOWER(TRIM($2))
       LIMIT 1`,
      [normalizedName, normalizedCountry]
    );
    if (exact.rows.length) {
      if (normalizedContinent && !exact.rows[0].continent) {
        const updated = await query(
          'UPDATE districts SET continent = $1 WHERE id = $2 RETURNING id, name, country, continent',
          [normalizedContinent, exact.rows[0].id]
        );
        return res.json(updated.rows[0]);
      }
      return res.json(exact.rows[0]);
    }

    const byName = await query(
      `SELECT id, name, country, continent FROM districts WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
      [normalizedName]
    );
    if (byName.rows.length === 1 && !byName.rows[0].country) {
      const merged = await query(
        'UPDATE districts SET country = $1, continent = COALESCE($3, continent) WHERE id = $2 RETURNING id, name, country, continent',
        [normalizedCountry, byName.rows[0].id, normalizedContinent]
      );
      return res.json(merged.rows[0]);
    }

    const result = await query(
      'INSERT INTO districts (id, name, country, continent) VALUES ($1, $2, $3, $4) RETURNING id, name, country, continent',
      [uuidv4(), normalizedName, normalizedCountry, normalizedContinent]);
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
    const deleted = await deleteUnitWithDependencies('districts', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'District not found' });
    return res.json({ message: 'Deleted', deleted });
  } catch (err) {
    console.error('deleteDistrict error:', err.message, err.code);
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
};

module.exports = { getAreas, getStakes, getMissions, getDistricts,
  createStake, renameStake, deleteStake,
  createDistrict, renameDistrict, deleteDistrict };
