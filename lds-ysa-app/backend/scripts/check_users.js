const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432, database: 'lds_ysa_db',
  user: 'postgres', password: 'Kingzeedoch29'
});
pool.query("SELECT id, full_name, email, gender FROM users WHERE email NOT LIKE '%bishop%' AND email NOT LIKE '%leader%' ORDER BY created_at DESC LIMIT 30")
  .then(r => { r.rows.forEach(u => console.log(u.full_name, '|', u.email, '|', u.gender)); return pool.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
