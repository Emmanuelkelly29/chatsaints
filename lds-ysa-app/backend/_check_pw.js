require('dotenv').config();
const { query } = require('./src/config/database');

async function main() {
  try {
    const users = await query('SELECT id, full_name, phone_number, password_hash IS NOT NULL as has_password FROM users');
    console.log(JSON.stringify(users.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit();
}
main();
