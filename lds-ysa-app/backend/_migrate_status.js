require('dotenv').config();
const { query } = require('./src/config/database');

async function migrate() {
  try {
    await query('ALTER TABLE statuses ADD COLUMN IF NOT EXISTS text_content TEXT');
    console.log('Added text_content column');
    await query("ALTER TABLE statuses ADD COLUMN IF NOT EXISTS background_color VARCHAR(20) DEFAULT '#0A1628'");
    console.log('Added background_color column');
    // Also make media_url nullable (already is via schema but ensure)
    console.log('Migration complete');
  } catch (err) {
    console.error('Migration error:', err.message);
  }
  process.exit();
}
migrate();
