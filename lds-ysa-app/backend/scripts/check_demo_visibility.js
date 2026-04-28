// Check that demo users have directory_visible=true
const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432, database: 'lds_ysa_db',
  user: 'postgres', password: 'Kingzeedoch29'
});

async function run() {
  // Check directory_visible for demo users
  const res = await pool.query(`
    SELECT full_name, email, gender, directory_visible, profile_hidden, status
    FROM users WHERE email LIKE '%chatsaints.demo%' LIMIT 25
  `);
  if (res.rows.length === 0) {
    console.log('No demo users found');
  } else {
    res.rows.forEach(u => console.log(
      u.full_name, '|', u.gender, '| dir_visible:', u.directory_visible,
      '| hidden:', u.profile_hidden, '| status:', u.status
    ));
  }

  // Also ensure they are in the pool and approved
  const poolRes = await pool.query(`
    SELECT u.full_name, spm.approved, s.name AS stake, s.ysa_pool_active
    FROM stake_pool_members spm
    JOIN users u ON spm.user_id = u.id
    JOIN stakes s ON spm.stake_id = s.id
    WHERE u.email LIKE '%chatsaints.demo%'
    LIMIT 25
  `);
  console.log('\nPool members:');
  poolRes.rows.forEach(r => console.log(
    r.full_name, '| approved:', r.approved, '| stake:', r.stake, '| pool_active:', r.ysa_pool_active
  ));

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
