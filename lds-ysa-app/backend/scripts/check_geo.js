const { query } = require('../src/config/database');

(async () => {
  // Check areas
  const areas = await query('SELECT id, name, continent FROM areas ORDER BY continent, name');
  console.log('\n=== AREAS ===');
  areas.rows.forEach(a => console.log(`  [${a.continent || 'NULL'}] ${a.name} (${a.id})`));

  // Check coordinating councils
  const ccs = await query('SELECT cc.id, cc.name, cc.area_id, a.continent, a.name as area_name FROM coordinating_councils cc LEFT JOIN areas a ON cc.area_id = a.id ORDER BY a.continent, cc.name');
  console.log('\n=== COORDINATING COUNCILS ===');
  ccs.rows.forEach(c => console.log(`  [${c.continent || 'NULL'}] ${c.name} -> area: ${c.area_name || 'NONE'}`));

  // Check stakes
  const stakes = await query(`
    SELECT s.id, s.name, s.country, s.coordinating_council_id,
           a.continent, a.name as area_name
    FROM stakes s
    LEFT JOIN coordinating_councils cc ON s.coordinating_council_id = cc.id
    LEFT JOIN areas a ON cc.area_id = a.id
    ORDER BY a.continent NULLS FIRST, s.country, s.name
  `);
  console.log('\n=== STAKES (continent / country / name) ===');
  stakes.rows.forEach(s => console.log(`  [${s.continent || 'NULL'}] [${s.country || 'NULL'}] ${s.name}`));

  // Check districts
  const districts = await query(`
    SELECT d.id, d.name, d.country, d.mission_id,
           m.name as mission_name, m.area_id,
           a.continent, a.name as area_name
    FROM districts d
    LEFT JOIN missions m ON d.mission_id = m.id
    LEFT JOIN areas a ON m.area_id = a.id
    ORDER BY a.continent NULLS FIRST, d.country, d.name
  `).catch(() => ({ rows: [] }));
  console.log('\n=== DISTRICTS ===');
  if (districts.rows.length === 0) {
    console.log('  (no districts or query failed - checking table structure)');
    const cols = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'districts' ORDER BY ordinal_position").catch(() => ({ rows: [] }));
    cols.rows.forEach(c => console.log(`  col: ${c.column_name} (${c.data_type})`));
    const distRows = await query('SELECT * FROM districts LIMIT 5').catch(() => ({ rows: [] }));
    console.log('  sample rows:', JSON.stringify(distRows.rows, null, 2));
  } else {
    districts.rows.forEach(d => console.log(`  [${d.continent || 'NULL'}] [${d.country || 'NULL'}] ${d.name}`));
  }

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
