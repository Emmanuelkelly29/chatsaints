const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Kingzeedoch29@localhost:5432/lds_ysa_db' });

(async () => {
  try {
    // Delete old empty/duplicate announcements
    await pool.query(`
      DELETE FROM announcements
      WHERE id IN (
        SELECT a.id FROM announcements a
        LEFT JOIN announcement_recipients ar ON ar.announcement_id = a.id
        WHERE ar.user_id IS NULL
      )
    `);
    console.log('Cleaned up empty announcements.');

    // Get all 3 seeded announcements
    const { rows: anns } = await pool.query(`
      SELECT id FROM announcements
      WHERE title IN (
        '📢 Message from Church Headquarters',
        '🌍 Area Office Notice – Youth Initiative',
        '⛪ Stake Conference – Save the Date'
      )
    `);

    // Get all active users
    const { rows: users } = await pool.query(`SELECT id FROM users WHERE status NOT IN ('suspended')`);

    for (const ann of anns) {
      for (const user of users) {
        await pool.query(`
          INSERT INTO announcement_recipients (id, announcement_id, user_id)
          VALUES (gen_random_uuid(), $1, $2)
          ON CONFLICT (announcement_id, user_id) DO NOTHING
        `, [ann.id, user.id]);
      }
      console.log(`Ann ${ann.id}: ensured all ${users.length} users are recipients.`);
    }

    console.log('\nDone. All users can now see all 3 announcements.');
  } catch (e) {
    console.error(e.message);
  } finally {
    await pool.end();
  }
})();
