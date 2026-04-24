'use strict';
/**
 * Seed 3 sample announcements directly into the DB.
 * Run once: node seed_announcements.js
 */
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: 'postgresql://postgres:Kingzeedoch29@localhost:5432/lds_ysa_db',
});

const query = (text, params) => pool.query(text, params);

// ── Sample announcements ────────────────────────────────────────
const ANNOUNCEMENTS = [
  {
    roleHint: ['first_presidency', 'apostle', 'general_authority', 'area_presidency', 'it_support'],
    scope: 'global',
    title: '📢 Message from Church Headquarters',
    body:
      'Dear members, we remind you that April General Conference devotionals begin this Saturday. ' +
      'Please gather with your families to receive counsel from the Lord\'s servants. ' +
      'Streaming is available at churchofjesuschrist.org. We love you and pray for your continued faithfulness.',
  },
  {
    roleHint: ['area_authority', 'area_presidency', 'coordinating_council'],
    scope: 'stake',
    title: '🌍 Area Office Notice – Youth Initiative',
    body:
      'The Area Presidency invites all YSA units to participate in the upcoming Area-wide Youth Initiative. ' +
      'Ward and branch leaders should register their units by May 10, 2026 through the MLS system. ' +
      'Printed materials will be distributed through stake presidents. Contact your area coordinator for details.',
  },
  {
    roleHint: ['stake_presidency', 'bishop'],
    scope: 'stake',
    title: '⛪ Stake Conference – Save the Date',
    body:
      'The following dates have been set for our upcoming Stake Conference:\n\n' +
      '• Stake Priesthood Leadership Session: Saturday, May 30, 2026 at 7:00 PM\n' +
      '• General Session (all members): Sunday, May 31, 2026 at 10:00 AM\n\n' +
      'President Thomas Johnson will be presiding. Please make arrangements to attend. ' +
      'A special youth fireside will follow the Saturday session at 9:30 PM.',
  },
];

(async () => {
  try {
    // Fetch all users grouped by role
    const { rows: users } = await query(
      `SELECT id, full_name, role, stake_id FROM users WHERE status NOT IN ('suspended') ORDER BY created_at`
    );

    if (users.length === 0) {
      console.error('No users found in the database. Please register at least one user first.');
      process.exit(1);
    }

    console.log(`Found ${users.length} users in DB.`);

    for (const ann of ANNOUNCEMENTS) {
      // Find a suitable sender
      let sender = users.find(u => ann.roleHint.includes(u.role));

      // Fallback: use the first user available (it_support or any)
      if (!sender) {
        sender = users.find(u => u.role === 'it_support') || users[0];
        console.log(`  No ${ann.roleHint.join('/')} user found. Using ${sender.full_name} (${sender.role}) as sender.`);
      } else {
        console.log(`  Sender: ${sender.full_name} (${sender.role})`);
      }

      const annId = uuidv4();
      const scope = ann.scope;
      const scopeId = scope === 'stake' ? (sender.stake_id || null) : null;

      // Insert announcement
      await query(
        `INSERT INTO announcements (id, sender_id, title, body, scope, scope_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [annId, sender.id, ann.title, ann.body, scope, scopeId]
      );

      // Determine recipients
      let recipientRows;
      if (scope === 'global') {
        const res = await query(
          `SELECT id FROM users WHERE id != $1 AND status NOT IN ('suspended')`,
          [sender.id]
        );
        recipientRows = res.rows;
      } else if (scope === 'stake' && scopeId) {
        const res = await query(
          `SELECT id FROM users WHERE stake_id = $1 AND id != $2 AND status NOT IN ('suspended')`,
          [scopeId, sender.id]
        );
        recipientRows = res.rows;
      } else {
        // scope is stake but no stake_id – send to all users as fallback
        const res = await query(
          `SELECT id FROM users WHERE id != $1 AND status NOT IN ('suspended')`,
          [sender.id]
        );
        recipientRows = res.rows;
      }

      // Include sender themselves so they can see it too
      const senderAsRecipient = await query(
        `SELECT id FROM users WHERE id = $1`, [sender.id]
      );
      const allRecipients = [...recipientRows, ...senderAsRecipient.rows];

      if (allRecipients.length > 0) {
        const placeholders = allRecipients
          .map((_, i) => `(gen_random_uuid(), $${i * 2 + 1}, $${i * 2 + 2})`)
          .join(', ');
        const values = allRecipients.flatMap(r => [annId, r.id]);
        await query(
          `INSERT INTO announcement_recipients (id, announcement_id, user_id)
           VALUES ${placeholders}
           ON CONFLICT DO NOTHING`,
          values
        );
      }

      console.log(`  ✅ "${ann.title}" sent to ${allRecipients.length} recipient(s).`);
    }

    console.log('\nAll 3 sample announcements seeded successfully!');
  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await pool.end();
  }
})();
