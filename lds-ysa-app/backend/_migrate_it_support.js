require('dotenv').config();
const { query } = require('./src/config/database');

async function migrate() {
  try {
    // Add it_support to the leadership_role enum
    await query("ALTER TYPE leadership_role ADD VALUE IF NOT EXISTS 'it_support'");
    console.log('Added it_support to leadership_role enum');

    // Update the bishop account (phone 08031114594) to it_support, approved
    const result = await query(
      "UPDATE users SET role='it_support', is_approved=true, status='active' WHERE phone_number='08031114594' RETURNING id, full_name, role, is_approved"
    );
    if (result.rows.length) {
      console.log('Updated user:', result.rows[0]);
    } else {
      console.log('No user found with phone 08031114594');
    }

    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  }
}

migrate();
