'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, getClient } = require('../config/database');
const { authenticate, requireActive } = require('../middleware/auth');
const { ROLE_TIER } = require('../utils/accessControl');

const COUNTRY_CONTINENT = {
  nigeria: 'Africa',
  ghana: 'Africa',
  kenya: 'Africa',
  uganda: 'Africa',
  southafrica: 'Africa',
  southafricarepublic: 'Africa',
  ethiopia: 'Africa',
  morocco: 'Africa',
  egypt: 'Africa',
  unitedstates: 'North America',
  usa: 'North America',
  canada: 'North America',
  mexico: 'North America',
  brazil: 'South America',
  argentina: 'South America',
  colombia: 'South America',
  peru: 'South America',
  chile: 'South America',
  unitedkingdom: 'Europe',
  uk: 'Europe',
  ireland: 'Europe',
  france: 'Europe',
  germany: 'Europe',
  italy: 'Europe',
  spain: 'Europe',
  portugal: 'Europe',
  netherlands: 'Europe',
  belgium: 'Europe',
  sweden: 'Europe',
  norway: 'Europe',
  finland: 'Europe',
  denmark: 'Europe',
  poland: 'Europe',
  romania: 'Europe',
  ukraine: 'Europe',
  russia: 'Europe',
  india: 'Asia',
  pakistan: 'Asia',
  bangladesh: 'Asia',
  china: 'Asia',
  japan: 'Asia',
  southkorea: 'Asia',
  philippines: 'Asia',
  singapore: 'Asia',
  indonesia: 'Asia',
  thailand: 'Asia',
  vietnam: 'Asia',
  malaysia: 'Asia',
  srilanka: 'Asia',
  austria: 'Europe',
  switzerland: 'Europe',
  australia: 'Oceania',
  newzealand: 'Oceania',
  fiji: 'Oceania',
  papuanewguinea: 'Oceania',
};

const VALID_CONTINENTS = new Set([
  'Africa',
  'North America',
  'South America',
  'Europe',
  'Asia',
  'Oceania',
]);

function normalizeCountryKey(country) {
  return (country || '').toString().toLowerCase().replace(/[^a-z]/g, '');
}

function inferContinent(country) {
  const key = normalizeCountryKey(country);
  return key ? COUNTRY_CONTINENT[key] || null : null;
}

function canManagePool(user) {
  const tier = ROLE_TIER[user.role] || 0;
  return user.role === 'it_support' || tier >= 4 || user.role === 'bishop' || user.role === 'ysa_rep';
}

function hasGlobalPoolControl(user) {
  const tier = ROLE_TIER[user.role] || 0;
  return user.role === 'it_support' || tier >= 6;
}

function byContinentThenName(a, b) {
  const ca = (a.continent || 'ZZZ').toString();
  const cb = (b.continent || 'ZZZ').toString();
  const continentCmp = ca.localeCompare(cb);
  if (continentCmp !== 0) return continentCmp;
  return (a.name || '').toString().localeCompare((b.name || '').toString());
}

function normalizePoolUnit(row) {
  const continent = row.unit_continent || row.area_continent || inferContinent(row.country);
  if (!continent) return null;
  return { ...row, continent };
}

// GET /api/ysa-pool/members — list all pool members for leader's stake
router.get('/members', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!canManagePool(req.user))
      return res.status(403).json({ error: 'Leaders only' });

    const globalControl = hasGlobalPoolControl(req.user);
    const includeMembers = req.query.includeMembers !== 'false';

    let members = [];
    if (includeMembers) {
      // IT Support/global admin sees all stakes; scoped leaders see only their own stake.
      const stakeFilter = globalControl ? '' : 'AND spm.stake_id = $1';
      const params = globalControl ? [] : [req.user.stake_id || null];

      const result = await query(
        `SELECT spm.id, spm.user_id, spm.stake_id, spm.approved, spm.approved_at, spm.created_at,
                u.full_name, u.phone_number, u.email, u.profile_photo_url, u.role,
                s.name as stake_name, s.country as stake_country,
                ab.full_name as added_by_name
         FROM stake_pool_members spm
         JOIN users u ON spm.user_id = u.id
         LEFT JOIN stakes s ON spm.stake_id = s.id
         LEFT JOIN users ab ON spm.added_by = ab.id
         WHERE 1=1 ${stakeFilter}
         ORDER BY spm.approved ASC, spm.created_at DESC`,
        params
      );
      members = result.rows;
    }

    // Also get stake pool active status (with country for continent grouping)
    const stakeResult = globalControl
      ? await query(
          `SELECT s.id, s.name, s.country, s.continent AS unit_continent, s.ysa_pool_active,
                  a.continent AS area_continent
           FROM stakes s
           LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
           LEFT JOIN areas a ON cc.area_id = a.id`
        )
      : await query(
          `SELECT s.id, s.name, s.country, s.continent AS unit_continent, s.ysa_pool_active,
                  a.continent AS area_continent
           FROM stakes s
           LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
           LEFT JOIN areas a ON cc.area_id = a.id
           WHERE s.id = $1`,
          [req.user.stake_id]
        );

    // Get districts (with country for continent grouping)
    const districtResult = globalControl
      ? await query(
          `SELECT d.id, d.name, d.country, d.continent AS unit_continent, d.ysa_pool_active,
                  a.continent AS area_continent
           FROM districts d
           LEFT JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
           LEFT JOIN areas a ON cc.area_id = a.id`
        )
      : await query(
          `SELECT d.id, d.name, d.country, d.continent AS unit_continent, d.ysa_pool_active,
                  a.continent AS area_continent
           FROM districts d
           LEFT JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
           LEFT JOIN areas a ON cc.area_id = a.id
           WHERE d.id = (SELECT district_id FROM users WHERE id = $1)`,
          [req.user.id]
        );

    const skippedUnits = [];

    const stakes = (stakeResult.rows || [])
      .map((row) => {
        const normalized = normalizePoolUnit(row);
        if (!normalized) {
          skippedUnits.push({
            unit_type: 'stake',
            id: row.id,
            name: row.name,
            country: row.country || null,
            unit_continent: row.unit_continent || null,
            area_continent: row.area_continent || null,
          });
        }
        return normalized;
      })
      .filter(Boolean)
      .sort(byContinentThenName);

    const districts = (districtResult.rows || [])
      .map((row) => {
        const normalized = normalizePoolUnit(row);
        if (!normalized) {
          skippedUnits.push({
            unit_type: 'district',
            id: row.id,
            name: row.name,
            country: row.country || null,
            unit_continent: row.unit_continent || null,
            area_continent: row.area_continent || null,
          });
        }
        return normalized;
      })
      .filter(Boolean)
      .sort(byContinentThenName);

    res.json({ data: members, stakes, districts, skipped_units: skippedUnits });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/members/:id/approve — approve a pool member
router.post('/members/:id/approve', authenticate, requireActive, async (req, res, next) => {
  try {
    const allowed = ['ysa_rep','bishop','stake_presidency','it_support'];
    if (!allowed.includes(req.user.role))
      return res.status(403).json({ error: 'Leaders only' });

    await query(
      'UPDATE stake_pool_members SET approved=true, approved_at=NOW(), added_by=$1 WHERE id=$2',
      [req.user.id, req.params.id]
    );
    res.json({ message: 'Member approved' });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/members/:id/remove — remove a pool member
router.post('/members/:id/remove', authenticate, requireActive, async (req, res, next) => {
  try {
    const allowed = ['ysa_rep','bishop','stake_presidency','it_support'];
    if (!allowed.includes(req.user.role))
      return res.status(403).json({ error: 'Leaders only' });

    await query('DELETE FROM stake_pool_members WHERE id=$1', [req.params.id]);
    res.json({ message: 'Member removed' });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/toggle-district/:districtId — toggle district pool active status
router.post('/toggle-district/:districtId', authenticate, requireActive, async (req, res, next) => {
  try {
    if ((ROLE_TIER[req.user.role] || 0) < 4 && req.user.role !== 'it_support')
      return res.status(403).json({ error: 'Only mission presidents or above' });

    const result = await query(
      'UPDATE districts SET ysa_pool_active = NOT ysa_pool_active WHERE id = $1 RETURNING ysa_pool_active',
      [req.params.districtId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'District not found' });
    res.json({ active: result.rows[0].ysa_pool_active });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/toggle/:stakeId — toggle pool active status
router.post('/toggle/:stakeId', authenticate, requireActive, async (req, res, next) => {
  try {
    if ((ROLE_TIER[req.user.role] || 0) < 4 && req.user.role !== 'it_support')
      return res.status(403).json({ error: 'Only stake presidents or above' });

    const result = await query(
      'UPDATE stakes SET ysa_pool_active = NOT ysa_pool_active WHERE id = $1 RETURNING ysa_pool_active',
      [req.params.stakeId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Stake not found' });
    res.json({ active: result.rows[0].ysa_pool_active });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/toggle-all — bulk open/close filtered pool records
router.post('/toggle-all', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!canManagePool(req.user)) {
      return res.status(403).json({ error: 'Only leaders can bulk update pools' });
    }
    const globalControl = hasGlobalPoolControl(req.user);

    const { active, target = 'all', continent, query: searchQuery } = req.body || {};
    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'active must be true or false' });
    }
    if (!['all', 'stakes', 'districts'].includes(target)) {
      return res.status(400).json({ error: 'target must be all, stakes, or districts' });
    }

    const wantedContinent = (continent || '').toString().trim().toLowerCase();
    const search = (searchQuery || '').toString().trim().toLowerCase();

    const matchFilters = (row) => {
      const rowContinent = ((row.continent || inferContinent(row.country)) || '').toLowerCase();
      const continentOk = !wantedContinent || wantedContinent === 'all' || rowContinent === wantedContinent;
      const haystack = `${row.name || ''} ${row.country || ''}`.toLowerCase();
      const searchOk = !search || haystack.includes(search);
      return continentOk && searchOk;
    };

    let stakesUpdated = 0;
    let districtsUpdated = 0;

    if (target === 'all' || target === 'stakes') {
      const rows = globalControl
        ? await query('SELECT id, name, country, continent FROM stakes')
        : await query('SELECT id, name, country, continent FROM stakes WHERE id = $1', [req.user.stake_id]);
      const ids = rows.rows.filter(matchFilters).map((r) => r.id);
      if (ids.length) {
        const updated = await query(
          'UPDATE stakes SET ysa_pool_active = $1 WHERE id = ANY($2::uuid[])',
          [active, ids]
        );
        stakesUpdated = updated.rowCount || 0;
      }
    }

    if (target === 'all' || target === 'districts') {
      const rows = globalControl
        ? await query('SELECT id, name, country, continent FROM districts')
        : await query(
            'SELECT id, name, country, continent FROM districts WHERE id = (SELECT district_id FROM users WHERE id = $1)',
            [req.user.id]
          );
      const ids = rows.rows.filter(matchFilters).map((r) => r.id);
      if (ids.length) {
        const updated = await query(
          'UPDATE districts SET ysa_pool_active = $1 WHERE id = ANY($2::uuid[])',
          [active, ids]
        );
        districtsUpdated = updated.rowCount || 0;
      }
    }

    return res.json({
      message: `Pool status set to ${active ? 'ON' : 'OFF'}`,
      target,
      active,
      updated: {
        stakes: stakesUpdated,
        districts: districtsUpdated,
        total: stakesUpdated + districtsUpdated,
      },
    });
  } catch (err) { next(err); }
});

// PATCH /api/ysa-pool/units/:unitType/:id/location — update country/continent correction
router.patch('/units/:unitType/:id/location', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!hasGlobalPoolControl(req.user)) {
      return res.status(403).json({ error: 'Only IT support or global leaders can correct unit location' });
    }

    const unitType = (req.params.unitType || '').toLowerCase();
    const id = req.params.id;
    const country = (req.body.country || '').toString().trim();
    const continent = (req.body.continent || '').toString().trim();

    if (!['stake', 'district'].includes(unitType)) {
      return res.status(400).json({ error: 'unitType must be stake or district' });
    }
    if (!country) {
      return res.status(400).json({ error: 'country is required' });
    }
    if (!continent || !VALID_CONTINENTS.has(continent)) {
      return res.status(400).json({ error: 'continent must be a valid continent' });
    }

    const table = unitType === 'stake' ? 'stakes' : 'districts';
    const result = await query(
      `UPDATE ${table}
       SET country = $1,
           continent = $2
       WHERE id = $3
       RETURNING id, name, country, continent`,
      [country, continent, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: `${unitType} not found` });
    }

    return res.json({
      message: `${unitType} location updated`,
      unit: { ...result.rows[0], unit_type: unitType },
    });
  } catch (err) { next(err); }
});

// DELETE /api/ysa-pool/units/:unitType/:id — delete a stake or district from pool
router.delete('/units/:unitType/:id', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!hasGlobalPoolControl(req.user)) {
      return res.status(403).json({ error: 'Only IT support or global leaders can delete pool units' });
    }

    const unitType = (req.params.unitType || '').toLowerCase();
    const id = req.params.id;

    if (!['stake', 'district'].includes(unitType)) {
      return res.status(400).json({ error: 'unitType must be stake or district' });
    }

    const table = unitType === 'stake' ? 'stakes' : 'districts';

    // Keep conversation safety check for districts to avoid orphaning chat data.
    // Some deployments do not have conversations.district_id, so guard this check.
    if (unitType === 'district') {
      const convDistrictColumn = await query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'conversations'
           AND column_name = 'district_id'
         LIMIT 1`
      );

      if (convDistrictColumn.rows.length) {
        const deps = await query(
          `SELECT COUNT(*) as count FROM conversations WHERE district_id = $1`,
          [id]
        );
        const convCount = parseInt(deps.rows[0]?.count || 0);
        if (convCount > 0) {
          return res.status(409).json({
            error: `Cannot delete: this district has ${convCount} conversations. Archive them first.`
          });
        }
      }
    }

    // Attempt the delete with schema-driven FK cleanup in one transaction.
    const targetTable = unitType === 'stake' ? 'stakes' : 'districts';
    const isSafeIdent = (s) => /^[a-z_][a-z0-9_]*$/i.test(s);

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
    let result;
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

      result = await client.query(
        `DELETE FROM ${table}
         WHERE id = $1
         RETURNING id, name`,
        [id]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    if (!result.rows.length) {
      return res.status(404).json({ error: `${unitType} not found` });
    }

    console.log(`Deleted ${unitType} ${id}: ${result.rows[0].name}`);

    return res.json({
      message: `${unitType} deleted successfully`,
      unit: { ...result.rows[0], unit_type: unitType },
    });
  } catch (err) { 
    console.error('Delete unit error:', err.message, err.code);
    res.status(500).json({ error: `Failed to delete: ${err.message}` });
  }
});

// POST /api/ysa-pool/add — YSA Rep adds a member to pool
router.post('/add', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!['ysa_rep', 'stake_presidency', 'bishop'].includes(req.user.role))
      return res.status(403).json({ error: 'Only YSA reps can manage the pool' });

    const { userId, stakeId } = req.body;
    if (!userId || !stakeId) return res.status(400).json({ error: 'userId and stakeId are required' });

    const result = await query(
      `INSERT INTO stake_pool_members (id, user_id, stake_id, added_by, approved)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (user_id, stake_id) DO NOTHING
       RETURNING *`,
      [uuidv4(), userId, stakeId, req.user.id]
    );
    res.status(201).json({ member: result.rows[0] || null });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/open/:stakeId — open a stake pool for cross-stake visibility
router.post('/open/:stakeId', authenticate, requireActive, async (req, res, next) => {
  try {
    if ((ROLE_TIER[req.user.role] || 0) < 4)
      return res.status(403).json({ error: 'Only stake presidents can open the pool' });

    const result = await query(
      `UPDATE stakes SET ysa_pool_active = true WHERE id = $1 RETURNING *`,
      [req.params.stakeId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Stake not found' });
    res.json({ stake: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/my-status — check current user's pool membership status
router.get('/my-status', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!req.user.stake_id)
      return res.json({ status: 'no_stake' });

    const stakeCheck = await query(
      'SELECT ysa_pool_active FROM stakes WHERE id = $1',
      [req.user.stake_id]
    );
    const stakeOpen = stakeCheck.rows.length > 0 && stakeCheck.rows[0].ysa_pool_active;

    const member = await query(
      'SELECT id, approved, approved_at, created_at FROM stake_pool_members WHERE user_id = $1 AND stake_id = $2',
      [req.user.id, req.user.stake_id]
    );

    if (!member.rows.length) {
      return res.json({ status: 'not_requested', stake_open: stakeOpen });
    }

    const row = member.rows[0];
    return res.json({
      status: row.approved ? 'approved' : 'pending',
      stake_open: stakeOpen,
      member_id: row.id,
      requested_at: row.created_at,
      approved_at: row.approved_at,
    });
  } catch (err) { next(err); }
});

// POST /api/ysa-pool/request — YSA member self-nominates to join pool
router.post('/request', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!req.user.stake_id)
      return res.status(400).json({ error: 'You are not assigned to a stake' });

    const { v4: uuidv4local } = require('uuid');
    const result = await query(
      `INSERT INTO stake_pool_members (id, user_id, stake_id, added_by, approved)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (user_id, stake_id) DO NOTHING
       RETURNING *`,
      [uuidv4(), req.user.id, req.user.stake_id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(409).json({ error: 'Already requested' });
    }
    res.status(201).json({ message: 'Request submitted. Awaiting leader approval.' });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/discover — discover YSA from all open pools worldwide
router.get('/discover', authenticate, requireActive, async (req, res, next) => {
  try {
    // Find all approved members in open stakes worldwide
    const contacts = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, u.gender, u.bio,
              s.id AS stake_id, s.name AS stake_name, s.country,
              d.id AS district_id, d.name AS district_name,
              a.continent, a.name AS area_name,
              CASE
                WHEN u.date_of_birth IS NULL THEN NULL
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 18 AND 22 THEN '18-22'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 23 AND 26 THEN '23-26'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 27 AND 30 THEN '27-30'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 31 AND 35 THEN '31-35'
                ELSE 'YSA'
              END AS age_range
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       JOIN stakes s ON spm.stake_id = s.id
       LEFT JOIN districts d ON u.district_id = d.id
       LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       LEFT JOIN areas a ON cc.area_id = a.id
       WHERE s.ysa_pool_active = true
         AND spm.approved = true
         AND u.status = 'active'
         AND u.profile_hidden = false
         AND u.directory_visible = true
         AND u.id != $1
       ORDER BY a.continent NULLS LAST, s.country, u.full_name`,
      [req.user.id]
    );
    res.json({ contacts: contacts.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/directory-stakes — ALL registered stakes AND districts (source of truth for global directory)
// Optional query params: age_ranges (comma-separated, e.g. "18-22,23-26"), gender ("male" or "female")
// When filters provided, only stakes with ≥1 matching member are returned.
router.get('/directory-stakes', authenticate, requireActive, async (req, res, next) => {
  try {
    // Validate inputs against strict whitelists to prevent SQL injection
    const VALID_AGE_SQL = {
      '18-22': 'EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 18 AND 22',
      '23-26': 'EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 23 AND 26',
      '27-30': 'EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 27 AND 30',
      '31-35': 'EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 31 AND 35',
    };
    const VALID_GENDERS = ['male', 'female'];

    const rawAges = typeof req.query.age_ranges === 'string' ? req.query.age_ranges.split(',') : [];
    const validAges = rawAges.map(a => a.trim()).filter(a => VALID_AGE_SQL[a]);
    const rawGender = (req.query.gender || '').toLowerCase();
    const validGender = VALID_GENDERS.includes(rawGender) ? rawGender : null;

    const hasFilter = validAges.length > 0 || validGender !== null;

    // Build extra conditions for the COUNT (appended after core membership checks)
    const ageExpr = validAges.length > 0
      ? `AND (${validAges.map(a => VALID_AGE_SQL[a]).join(' OR ')})`
      : '';
    const genderExpr = validGender ? `AND LOWER(u.gender) = '${validGender}'` : '';
    const extraConditions = `${ageExpr} ${genderExpr}`.trim();

    // Wrap UNION ALL in subquery so we can filter by member_count > 0 when needed
    const havingFilter = hasFilter ? 'WHERE member_count > 0' : '';

    const result = await query(
      `SELECT * FROM (
         -- Stakes
          SELECT s.id AS stake_id, s.name AS stake_name, s.country,
            a.continent AS continent,
                a.name AS area_name,
                'stake' AS unit_type,
                COUNT(DISTINCT CASE
                  WHEN spm.approved = true
                    AND u.status = 'active'
                    AND u.profile_hidden = false
                    AND u.directory_visible = true
                    AND u.id != $1
                    ${extraConditions}
                  THEN u.id END) AS member_count
         FROM stakes s
         LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
         LEFT JOIN areas a ON cc.area_id = a.id
         LEFT JOIN stake_pool_members spm ON spm.stake_id = s.id
         LEFT JOIN users u ON spm.user_id = u.id
         GROUP BY s.id, s.name, s.country, a.continent, a.name

         UNION ALL

         -- Districts (same structure)
          SELECT d.id AS stake_id, d.name AS stake_name, d.country,
            a.continent AS continent,
                a.name AS area_name,
                'district' AS unit_type,
                COUNT(DISTINCT CASE
                  WHEN spm.approved = true
                    AND u.status = 'active'
                    AND u.profile_hidden = false
                    AND u.directory_visible = true
                    AND u.id != $1
                    ${extraConditions}
                  THEN u.id END) AS member_count
         FROM districts d
         LEFT JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
         LEFT JOIN areas a ON cc.area_id = a.id
         LEFT JOIN stake_pool_members spm ON spm.stake_id = d.id
         LEFT JOIN users u ON spm.user_id = u.id
         GROUP BY d.id, d.name, d.country, a.continent, a.name
       ) AS combined
       ${havingFilter}
       ORDER BY continent NULLS LAST, country, stake_name`,
      [req.user.id]
    );
    const normalizedRows = result.rows
      .map((row) => {
        const continent = row.continent || inferContinent(row.country);
        return { ...row, continent };
      })
      .filter((row) => !!row.continent)
      .sort((a, b) => {
        const continentCmp = (a.continent || '').localeCompare(b.continent || '');
        if (continentCmp !== 0) return continentCmp;
        const countryCmp = (a.country || '').localeCompare(b.country || '');
        if (countryCmp !== 0) return countryCmp;
        return (a.stake_name || '').localeCompare(b.stake_name || '');
      });

    res.json({ stakes: normalizedRows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/stake-members/:stakeId — load members for one stake OR district (lazy, on-demand)
router.get('/stake-members/:stakeId', authenticate, requireActive, async (req, res, next) => {
  try {
    const { stakeId } = req.params;
    // Works for both stake IDs and district IDs — pool table uses same stake_id column
    const members = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, u.gender, u.bio,
              spm.stake_id,
              COALESCE(s.name, d.name) AS stake_name,
              COALESCE(s.country, d.country) AS country,
              COALESCE(a_s.continent, a_d.continent) AS continent,
              CASE
                WHEN u.date_of_birth IS NULL THEN NULL
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 18 AND 22 THEN '18-22'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 23 AND 26 THEN '23-26'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 27 AND 30 THEN '27-30'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 31 AND 35 THEN '31-35'
                ELSE 'YSA'
              END AS age_range
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       LEFT JOIN stakes s ON spm.stake_id = s.id
       LEFT JOIN coordinating_councils cc_s ON s.coordinating_council_id = cc_s.id
       LEFT JOIN areas a_s ON cc_s.area_id = a_s.id
       LEFT JOIN districts d ON spm.stake_id = d.id
       LEFT JOIN coordinating_councils cc_d ON d.coordinating_council_id = cc_d.id
       LEFT JOIN areas a_d ON cc_d.area_id = a_d.id
       WHERE spm.stake_id = $1
         AND spm.approved = true
         AND u.status = 'active'
         AND u.profile_hidden = false
         AND u.directory_visible = true
         AND u.id != $2
       ORDER BY u.full_name`,
      [stakeId, req.user.id]
    );
    res.json({ members: members.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/stakes-list — list all open stakes with YSA count (for directory browsing)
router.get('/stakes-list', authenticate, requireActive, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.id, s.name, s.country, a.continent, a.name AS area_name,
              COUNT(spm.id) AS member_count
       FROM stakes s
       LEFT JOIN stake_pool_members spm ON spm.stake_id = s.id AND spm.approved = true
       LEFT JOIN users u ON spm.user_id = u.id AND u.status = 'active' AND u.directory_visible = true
       LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       LEFT JOIN areas a ON cc.area_id = a.id
       WHERE s.ysa_pool_active = true
       GROUP BY s.id, s.name, s.country, a.continent, a.name
       ORDER BY a.continent NULLS LAST, s.country, s.name`,
      []
    );
    res.json({ stakes: result.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/global — missionaries browse worldwide approved pool members (read-only)
router.get('/global', authenticate, requireActive, async (req, res, next) => {
  try {
    const contacts = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, u.gender, u.bio,
              s.id AS stake_id, s.name AS stake_name, s.country,
              d.id AS district_id, d.name AS district_name,
              a.continent, a.name AS area_name,
              CASE
                WHEN u.date_of_birth IS NULL THEN NULL
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 18 AND 22 THEN '18-22'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 23 AND 26 THEN '23-26'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 27 AND 30 THEN '27-30'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 31 AND 35 THEN '31-35'
                ELSE 'YSA'
              END AS age_range
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       JOIN stakes s ON spm.stake_id = s.id
       LEFT JOIN districts d ON u.district_id = d.id
       LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
       LEFT JOIN areas a ON cc.area_id = a.id
       WHERE s.ysa_pool_active = true
         AND spm.approved = true
         AND u.status = 'active'
         AND u.profile_hidden = false
         AND u.directory_visible = true
         AND u.id != $1
       ORDER BY a.continent NULLS LAST, s.country, u.full_name`,
      [req.user.id]
    );
    res.json({ contacts: contacts.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/missionary-directory — for missionaries: browse fellow missionaries worldwide, grouped by mission
router.get('/missionary-directory', authenticate, requireActive, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.id AS stake_id, m.name AS stake_name, m.country,
              NULL AS continent,
              'mission' AS unit_type,
              COUNT(DISTINCT CASE
                WHEN u.status = 'active'
                  AND u.profile_hidden = false
                  AND u.directory_visible = true
                  AND u.id != $1
                  AND u.role = 'missionary'
                THEN u.id END) AS member_count
       FROM missions m
       LEFT JOIN users u ON u.mission_id = m.id
       GROUP BY m.id, m.name, m.country
       ORDER BY m.country, m.name`,
      [req.user.id]
    );

    const normalizedRows = result.rows
      .map((row) => {
        const continent = row.continent || inferContinent(row.country);
        return { ...row, continent };
      })
      .sort((a, b) => {
        const continentCmp = (a.continent || '').localeCompare(b.continent || '');
        if (continentCmp !== 0) return continentCmp;
        const countryCmp = (a.country || '').localeCompare(b.country || '');
        if (countryCmp !== 0) return countryCmp;
        return (a.stake_name || '').localeCompare(b.stake_name || '');
      });

    res.json({ stakes: normalizedRows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/missionary-mission-members/:missionId — load missionaries in a specific mission
router.get('/missionary-mission-members/:missionId', authenticate, requireActive, async (req, res, next) => {
  try {
    const { missionId } = req.params;

    const members = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, u.gender, u.bio,
              m.name AS stake_name, m.country AS country, NULL AS continent
       FROM users u
       JOIN missions m ON u.mission_id = m.id
       WHERE u.mission_id = $1
         AND u.role = 'missionary'
         AND u.status = 'active'
         AND u.profile_hidden = false
         AND u.directory_visible = true
         AND u.id != $2
       ORDER BY u.full_name`,
      [missionId, req.user.id]
    );

    res.json({ members: members.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/leader-directory — for stake/district presidents: browse peer leaders worldwide
// Returns all stakes and districts with count of stake/district presidents per unit
router.get('/leader-directory', authenticate, requireActive, async (req, res, next) => {
  try {
    const LEADER_ROLES = ['stake_presidency', 'district_presidency'];

    const result = await query(
      `SELECT * FROM (
         -- Stakes: count presidents linked via stake_id
         SELECT s.id AS stake_id, s.name AS stake_name, s.country,
                COALESCE(s.continent, a.continent) AS continent,
                'stake' AS unit_type,
                COUNT(DISTINCT CASE
                  WHEN u.status = 'active'
                    AND u.profile_hidden = false
                    AND u.directory_visible = true
                    AND u.id != $1
                    AND u.role = ANY($2::text[])
                  THEN u.id END) AS member_count
         FROM stakes s
         LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
         LEFT JOIN areas a ON cc.area_id = a.id
         LEFT JOIN users u ON u.stake_id = s.id
         GROUP BY s.id, s.name, s.country, s.continent, a.continent

         UNION ALL

         -- Districts: count presidents linked via district_id
         SELECT d.id AS stake_id, d.name AS stake_name, d.country,
                COALESCE(d.continent, a.continent) AS continent,
                'district' AS unit_type,
                COUNT(DISTINCT CASE
                  WHEN u.status = 'active'
                    AND u.profile_hidden = false
                    AND u.directory_visible = true
                    AND u.id != $1
                    AND u.role = ANY($2::text[])
                  THEN u.id END) AS member_count
         FROM districts d
         LEFT JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
         LEFT JOIN areas a ON cc.area_id = a.id
         LEFT JOIN users u ON u.district_id = d.id
         GROUP BY d.id, d.name, d.country, d.continent, a.continent
       ) AS combined
       ORDER BY continent NULLS LAST, country, stake_name`,
      [req.user.id, LEADER_ROLES]
    );

    const normalizedRows = result.rows
      .map((row) => {
        const continent = row.continent || inferContinent(row.country);
        return { ...row, continent };
      })
      .filter((row) => !!row.continent)
      .sort((a, b) => {
        const continentCmp = (a.continent || '').localeCompare(b.continent || '');
        if (continentCmp !== 0) return continentCmp;
        const countryCmp = (a.country || '').localeCompare(b.country || '');
        if (countryCmp !== 0) return countryCmp;
        return (a.stake_name || '').localeCompare(b.stake_name || '');
      });

    res.json({ stakes: normalizedRows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/leader-members/:unitId — load stake/district presidents for a specific unit
router.get('/leader-members/:unitId', authenticate, requireActive, async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const LEADER_ROLES = ['stake_presidency', 'district_presidency'];

    const members = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, u.gender, u.bio,
              COALESCE(s.name, d.name) AS stake_name,
              COALESCE(s.country, d.country) AS country,
              COALESCE(s.continent, d.continent, a_s.continent, a_d.continent) AS continent
       FROM users u
       LEFT JOIN stakes s ON u.stake_id = s.id
       LEFT JOIN coordinating_councils cc_s ON s.coordinating_council_id = cc_s.id
       LEFT JOIN areas a_s ON cc_s.area_id = a_s.id
       LEFT JOIN districts d ON u.district_id = d.id
       LEFT JOIN coordinating_councils cc_d ON d.coordinating_council_id = cc_d.id
       LEFT JOIN areas a_d ON cc_d.area_id = a_d.id
       WHERE (u.stake_id = $1 OR u.district_id = $1)
         AND u.role = ANY($2::text[])
         AND u.status = 'active'
         AND u.profile_hidden = false
         AND u.directory_visible = true
         AND u.id != $3
       ORDER BY u.full_name`,
      [unitId, LEADER_ROLES, req.user.id]
    );

    res.json({ members: members.rows });
  } catch (err) { next(err); }
});

// GET /api/ysa-pool/my-stake — all approved YSA pool members in the caller's stake
// Any authenticated user with a stake_id can see their stake's pool
router.get('/my-stake', authenticate, requireActive, async (req, res, next) => {
  try {
    if (!req.user.stake_id)
      return res.status(200).json({ members: [], myStatus: 'no_stake', stake: null });

    // Get stake info
    const stakeRes = await query(
      'SELECT id, name, country, ysa_pool_active FROM stakes WHERE id = $1',
      [req.user.stake_id]
    );
    const stake = stakeRes.rows[0] || null;

    // Get caller's own pool status
    const selfRes = await query(
      'SELECT approved FROM stake_pool_members WHERE user_id = $1 AND stake_id = $2',
      [req.user.id, req.user.stake_id]
    );
    const myStatus = selfRes.rows.length
      ? (selfRes.rows[0].approved ? 'approved' : 'pending')
      : 'not_in_pool';

    // Get all approved members in this stake
    const membersRes = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url, u.role, u.gender, u.bio,
              spm.approved_at, u.status,
              CASE
                WHEN u.date_of_birth IS NULL THEN NULL
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 18 AND 22 THEN '18-22'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 23 AND 26 THEN '23-26'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 27 AND 30 THEN '27-30'
                WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 31 AND 35 THEN '31-35'
                ELSE 'YSA'
              END AS age_range
       FROM stake_pool_members spm
       JOIN users u ON spm.user_id = u.id
       WHERE spm.stake_id = $1
         AND spm.approved = true
         AND u.status = 'active'
         AND u.directory_visible = true
       ORDER BY u.full_name`,
      [req.user.stake_id]
    );

    res.json({ members: membersRes.rows, myStatus, stake });
  } catch (err) { next(err); }
});

module.exports = router;

