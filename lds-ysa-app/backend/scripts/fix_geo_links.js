// Migration: Fix NULL coordinating_council_id for stakes and districts
// so they appear under the correct continent in the global directory
const { query } = require('../src/config/database');

(async () => {
  console.log('Fixing NULL coordinating_council_id for stakes and districts...\n');

  // ─── Fix Stakes ───────────────────────────────────────────────────────────

  // Nigeria stakes
  const r1 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c1000000-0000-0000-0000-000000000001'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Nigeria'
  `);
  console.log(`Nigeria stakes fixed: ${r1.rowCount}`);

  // USA / United States stakes
  const r2 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000001'
    WHERE coordinating_council_id IS NULL AND country ILIKE ANY(ARRAY['USA','United States','us'])
  `);
  console.log(`USA stakes fixed: ${r2.rowCount}`);

  // Canada stakes
  const r3 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000002'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Canada'
  `);
  console.log(`Canada stakes fixed: ${r3.rowCount}`);

  // Mexico stakes
  const r4 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000003'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Mexico'
  `);
  console.log(`Mexico stakes fixed: ${r4.rowCount}`);

  // Brazil stakes
  const r5 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000004'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Brazil'
  `);
  console.log(`Brazil stakes fixed: ${r5.rowCount}`);

  // Argentina stakes
  const r6 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000005'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Argentina'
  `);
  console.log(`Argentina stakes fixed: ${r6.rowCount}`);

  // United Kingdom stakes
  const r7 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000006'
    WHERE coordinating_council_id IS NULL AND country ILIKE ANY(ARRAY['United Kingdom','UK','England'])
  `);
  console.log(`UK stakes fixed: ${r7.rowCount}`);

  // South Africa stakes
  const r8 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000007'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'South Africa'
  `);
  console.log(`South Africa stakes fixed: ${r8.rowCount}`);

  // India stakes
  const r9 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000008'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'India'
  `);
  console.log(`India stakes fixed: ${r9.rowCount}`);

  // Philippines stakes
  const r10 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000009'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Philippines'
  `);
  console.log(`Philippines stakes fixed: ${r10.rowCount}`);

  // Japan stakes
  const r11 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000010'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Japan'
  `);
  console.log(`Japan stakes fixed: ${r11.rowCount}`);

  // Australia stakes
  const r12 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000011'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Australia'
  `);
  console.log(`Australia stakes fixed: ${r12.rowCount}`);

  // New Zealand stakes
  const r13 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000012'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'New Zealand'
  `);
  console.log(`New Zealand stakes fixed: ${r13.rowCount}`);

  // Ghana stakes
  const r14 = await query(`
    UPDATE stakes SET coordinating_council_id = 'c1000000-0000-0000-0000-000000000002'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Ghana'
  `);
  console.log(`Ghana stakes fixed: ${r14.rowCount}`);

  // ─── Fix Districts ────────────────────────────────────────────────────────

  // Nigeria districts
  const d1 = await query(`
    UPDATE districts SET coordinating_council_id = 'c1000000-0000-0000-0000-000000000001'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Nigeria'
  `);
  console.log(`\nNigeria districts fixed: ${d1.rowCount}`);

  // Ghana districts
  const d2 = await query(`
    UPDATE districts SET coordinating_council_id = 'c1000000-0000-0000-0000-000000000002'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Ghana'
  `);
  console.log(`Ghana districts fixed: ${d2.rowCount}`);

  // USA districts
  const d3 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000001'
    WHERE coordinating_council_id IS NULL AND country ILIKE ANY(ARRAY['USA','United States','us'])
  `);
  console.log(`USA districts fixed: ${d3.rowCount}`);

  // Brazil districts
  const d4 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000004'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Brazil'
  `);
  console.log(`Brazil districts fixed: ${d4.rowCount}`);

  // Argentina/Chile/Peru districts
  const d5 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000005'
    WHERE coordinating_council_id IS NULL AND country ILIKE ANY(ARRAY['Argentina','Chile'])
  `);
  console.log(`Argentina/Chile districts fixed: ${d5.rowCount}`);

  const d6 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000004'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Peru'
  `);
  console.log(`Peru districts fixed: ${d6.rowCount}`);

  // UK/France/Germany districts
  const d7 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000006'
    WHERE coordinating_council_id IS NULL AND country ILIKE ANY(ARRAY['United Kingdom','UK','France','Germany','England'])
  `);
  console.log(`Europe districts fixed: ${d7.rowCount}`);

  // India districts
  const d8 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000008'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'India'
  `);
  console.log(`India districts fixed: ${d8.rowCount}`);

  // Philippines districts
  const d9 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000009'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Philippines'
  `);
  console.log(`Philippines districts fixed: ${d9.rowCount}`);

  // Australia districts
  const d10 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000011'
    WHERE coordinating_council_id IS NULL AND country ILIKE 'Australia'
  `);
  console.log(`Australia districts fixed: ${d10.rowCount}`);

  // New Zealand / Fiji / Pacific districts
  const d11 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000012'
    WHERE coordinating_council_id IS NULL AND country ILIKE ANY(ARRAY['New Zealand','Fiji','Tonga','Samoa','Pacific'])
  `);
  console.log(`Pacific districts fixed: ${d11.rowCount}`);

  // Kenya / Uganda / East Africa → Africa Central and South (South Africa CC covers this area)
  const d12 = await query(`
    UPDATE districts SET coordinating_council_id = 'c2000000-0000-0000-0000-000000000007'
    WHERE coordinating_council_id IS NULL AND country ILIKE ANY(ARRAY['Kenya','Uganda','Tanzania','Ethiopia','Rwanda'])
  `);
  console.log(`East Africa districts fixed: ${d12.rowCount}`);

  // ─── Verify ───────────────────────────────────────────────────────────────

  const nullStakes = await query(`
    SELECT name, country FROM stakes WHERE coordinating_council_id IS NULL ORDER BY country, name
  `);
  console.log(`\nStakes still with NULL CC (${nullStakes.rowCount}):`);
  nullStakes.rows.forEach(s => console.log(`  [${s.country}] ${s.name}`));

  const nullDistricts = await query(`
    SELECT name, country FROM districts WHERE coordinating_council_id IS NULL ORDER BY country, name
  `);
  console.log(`\nDistricts still with NULL CC (${nullDistricts.rowCount}):`);
  nullDistricts.rows.forEach(d => console.log(`  [${d.country}] ${d.name}`));

  console.log('\nDone!');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
