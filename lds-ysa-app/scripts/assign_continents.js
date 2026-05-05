// One-shot migration: assign continent and normalize country for all stakes & districts
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:Kingzeedoch29@localhost:5432/lds_ysa_db',
});

// country (as stored) → [continent, normalized country name]
const MAPPING = {
  'Argentina':     ['South America', 'Argentina'],
  'Brazil':        ['South America', 'Brazil'],
  'Canada':        ['North America', 'Canada'],
  'Fiji':          ['Oceania',       'Fiji'],
  'France':        ['Europe',        'France'],
  'Germany':       ['Europe',        'Germany'],
  'Ghana':         ['Africa',        'Ghana'],
  'India':         ['Asia',          'India'],
  'Japan':         ['Asia',          'Japan'],
  'Kenya':         ['Africa',        'Kenya'],
  'Mexico':        ['North America', 'Mexico'],
  'New Zealand':   ['Oceania',       'New Zealand'],
  'Nigeria':       ['Africa',        'Nigeria'],
  'Peru':          ['South America', 'Peru'],
  'South Africa':  ['Africa',        'South Africa'],
  'Uganda':        ['Africa',        'Uganda'],
  'United States': ['North America', 'United States'],
  'USA':           ['North America', 'United States'],  // normalize + assign
};

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [rawCountry, [continent, normCountry]] of Object.entries(MAPPING)) {
      for (const table of ['stakes', 'districts']) {
        const res = await client.query(
          'UPDATE ' + table + ' SET continent = $1, country = $2 WHERE country = $3 RETURNING name, country, continent',
          [continent, normCountry, rawCountry]
        );
        res.rows.forEach(r =>
          console.log('[' + table + '] ' + r.name + '  →  ' + r.country + ' / ' + r.continent)
        );
      }
    }
    await client.query('COMMIT');
    console.log('\nAll done.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
