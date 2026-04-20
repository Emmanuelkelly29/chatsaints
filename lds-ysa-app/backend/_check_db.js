require('dotenv').config();
const { query } = require('./src/config/database');

async function main() {
  try {
    // Check if password_hash column exists
    const cols = await query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash'"
    );
    console.log('password_hash column exists:', cols.rows.length > 0);

    // List users
    const users = await query('SELECT id, full_name, phone_number, email, role FROM users LIMIT 10');
    console.log('Users in database:', users.rows.length);
    console.log(JSON.stringify(users.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit();
}
main();
