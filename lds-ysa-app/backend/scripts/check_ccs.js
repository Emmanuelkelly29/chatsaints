const { query } = require('../src/config/database');

(async () => {
  // Get all coordinating councils with IDs
  const ccs = await query('SELECT id, name FROM coordinating_councils ORDER BY name');
  console.log('\n=== COORDINATING COUNCIL IDs ===');
  ccs.rows.forEach(c => console.log(`  "${c.name}" => '${c.id}'`));

  // See which districts have bad/missing CC links
  const distCCs = await query(`
    SELECT d.id, d.name, d.country, d.coordinating_council_id,
           cc.name as cc_name, a.continent
    FROM districts d
    LEFT JOIN coordinating_councils cc ON d.coordinating_council_id = cc.id
    LEFT JOIN areas a ON cc.area_id = a.id
    ORDER BY a.continent NULLS FIRST, d.country
  `);
  console.log('\n=== DISTRICTS with CC resolution ===');
  distCCs.rows.forEach(d => console.log(`  [${d.continent || 'NULL'}] [${d.country}] ${d.name} -> CC: ${d.cc_name || 'NONE'}`));

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
