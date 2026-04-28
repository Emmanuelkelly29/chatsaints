// Apply migration 007 and set demo user genders
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost', port: 5432, database: 'lds_ysa_db',
  user: 'postgres', password: 'Kingzeedoch29'
});

async function run() {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10)');
  console.log('Migration 007: gender column added (or already exists)');

  const femaleNames = [
    'Valentina Lopez', 'Charlotte Reed', 'Thandi Mokoena', 'Michelle Reyes',
    'Yuki Tanaka', 'Amara Jensen', 'Grace Wilson', 'Sofia Ortega',
    'Ava Walker', 'Isabela Silva'
  ];
  const maleNames = [
    'Lucas Harris', 'Benjamin Farias', 'Oliver Hughes',
    'Siya Dlamini', 'Daniel Santos', 'Noah Carter',
    'Liam Bennett', 'Haruto Sato', 'Mateo Ruiz', 'Gabriel Costa'
  ];

  const fr = await pool.query(
    "UPDATE users SET gender = 'female' WHERE full_name = ANY($1::text[])",
    [femaleNames]
  );
  console.log('Set female for', fr.rowCount, 'users');

  const mr = await pool.query(
    "UPDATE users SET gender = 'male' WHERE full_name = ANY($1::text[])",
    [maleNames]
  );
  console.log('Set male for', mr.rowCount, 'users');

  await pool.end();
  console.log('Done');
}

run().catch(e => { console.error(e.message); process.exit(1); });
