'use strict';

require('dotenv').config();

const { pool } = require('../src/config/database');

async function main() {
  const counts = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM users WHERE email LIKE '%@chatsaints.demo'"),
    pool.query("SELECT COUNT(*)::int AS count FROM stakes WHERE id::text LIKE 'e2000000-%'"),
    pool.query("SELECT COUNT(*)::int AS count FROM districts WHERE id::text LIKE 'd2000000-%'"),
    pool.query("SELECT COUNT(*)::int AS count FROM stake_pool_members WHERE id::text LIKE 'f2000000-%' AND approved = true"),
  ]);

  console.log(JSON.stringify({
    demoUsers: counts[0].rows[0].count,
    demoStakes: counts[1].rows[0].count,
    demoDistricts: counts[2].rows[0].count,
    demoPoolMembers: counts[3].rows[0].count,
  }, null, 2));

  const response = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: '+18015550101',
      password: 'Welcome123!',
    }),
  });

  console.log(`loginStatus=${response.status}`);
  console.log(await response.text());
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });