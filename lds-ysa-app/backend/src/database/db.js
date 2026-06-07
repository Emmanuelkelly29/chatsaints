const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'lds_ysa_db',
        user: process.env.DB_USER || 'lds_ysa_user',
        password: process.env.DB_PASSWORD,
      }),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Run migration
if (require.main === module) {
  (async () => {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    try {
      await pool.query(sql);
      console.log('✅ Database schema migrated successfully');
    } catch (err) {
      console.error('❌ Migration error:', err.message);
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { query, getClient, transaction, pool };
