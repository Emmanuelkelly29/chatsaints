const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const p = new Pool({ host:'localhost',port:5432,database:'lds_ysa_db',user:'postgres',password:'Kingzeedoch29' });

async function run() {
  const hash = await bcrypt.hash('Welcome123!', 12);
  const r = await p.query('UPDATE users SET password_hash = $1', [hash]);
  console.log('Updated rows:', r.rowCount);
  await p.end();
}
run().catch(e => { console.error(e.message); p.end(); });
