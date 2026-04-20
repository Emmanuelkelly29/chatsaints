require('dotenv').config();
const {query} = require('./src/config/database');
(async () => {
  try {
    // Check roles enum
    const r = await query("SELECT unnest(enum_range(NULL::leadership_role))::text as role");
    console.log('Roles:', r.rows.map(r => r.role).join(', '));

    // Check users
    const u = await query('SELECT id,full_name,phone_number,email,role FROM users ORDER BY created_at');
    console.log('Users:', JSON.stringify(u.rows, null, 2));

    // Check stakes and missions
    const s = await query('SELECT id,name FROM stakes LIMIT 5');
    console.log('Stakes:', JSON.stringify(s.rows, null, 2));
    const m = await query('SELECT id,name FROM missions LIMIT 5');
    console.log('Missions:', JSON.stringify(m.rows, null, 2));

    process.exit(0);
  } catch(e) {
    console.error(e.message);
    process.exit(1);
  }
})();
