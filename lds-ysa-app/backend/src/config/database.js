const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'lds_ysa_db',
  user: process.env.DB_USER || 'lds_admin',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('query', { text: text.substring(0, 80), duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    console.error('Database query error:', err.message);
    throw err;
  }
};

const getClient = () => pool.connect();

// Run startup migrations (idempotent)
const migrate = async () => {
  try {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false');
    await pool.query('ALTER TABLE stakes ADD COLUMN IF NOT EXISTS continent VARCHAR(100)');
    await pool.query('ALTER TABLE districts ADD COLUMN IF NOT EXISTS continent VARCHAR(100)');
    console.log('[DB] Startup migration OK (email_verified column)');
  } catch (err) {
    console.warn('[DB] Startup migration warning:', err.message);
  }
};
migrate();

module.exports = { query, getClient, pool };
