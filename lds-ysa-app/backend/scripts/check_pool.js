'use strict';
const { Pool } = require('pg');
const pool = new Pool({ user:'postgres', password:'Kingzeedoch29', database:'lds_ysa_db', host:'localhost', port:5432 });
pool.query(`
  SELECT u.full_name, u.gender, 
    CASE WHEN u.date_of_birth IS NULL THEN 'NULL_DOB'
         WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 18 AND 22 THEN '18-22'
         WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 23 AND 26 THEN '23-26'
         WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 27 AND 30 THEN '27-30'
         WHEN EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN 31 AND 35 THEN '31-35'
         ELSE 'YSA' END AS age_range
  FROM stake_pool_members spm
  JOIN users u ON spm.user_id = u.id
  WHERE spm.approved = true AND u.status = 'active'
  LIMIT 15
`).then(r => { r.rows.forEach(row => console.log(JSON.stringify(row))); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
