const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Kingzeedoch29@localhost:5432/lds_ysa_db' });
pool.query(`
  SELECT a.title, a.scope, u.full_name as sender,
         COUNT(ar.user_id) as recipient_count
  FROM announcements a
  JOIN users u ON u.id = a.sender_id
  LEFT JOIN announcement_recipients ar ON ar.announcement_id = a.id
  GROUP BY a.id, a.title, a.scope, u.full_name
  ORDER BY a.created_at DESC LIMIT 5
`).then(r => {
  console.log(JSON.stringify(r.rows, null, 2));
  // Also check IT Support's recipient entries
  return pool.query(`
    SELECT a.title, ar.is_read, ar.read_at, u2.full_name as recipient
    FROM announcement_recipients ar
    JOIN announcements a ON a.id = ar.announcement_id
    JOIN users u2 ON u2.id = ar.user_id
    WHERE u2.role = 'it_support'
    ORDER BY a.created_at DESC
  `);
}).then(r => {
  console.log('\nIT Support recipient entries:');
  console.log(JSON.stringify(r.rows, null, 2));
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
