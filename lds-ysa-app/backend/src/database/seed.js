const { query, pool } = require('./db');
require('dotenv').config();

const areas = [
  { name: 'Africa West Area', continent: 'Africa' },
  { name: 'Africa Central Area', continent: 'Africa' },
  { name: 'Africa South Area', continent: 'Africa' },
  { name: 'North America West Area', continent: 'North America' },
  { name: 'Europe Area', continent: 'Europe' },
  { name: 'Asia Area', continent: 'Asia' },
  { name: 'Pacific Area', continent: 'Oceania' },
  { name: 'South America North Area', continent: 'South America' },
];

const scriptures = [
  { book: '1 Nephi', chapter: 3, verse: 7, text: 'I will go and do the things which the Lord hath commanded, for I know that the Lord giveth no commandments unto the children of men, save he shall prepare a way for them that they may accomplish the thing which he commandeth them.', volume: 'Book of Mormon', reference: '1 Nephi 3:7' },
  { book: 'Alma', chapter: 37, verse: 6, text: 'By small and simple things are great things brought to pass.', volume: 'Book of Mormon', reference: 'Alma 37:6' },
  { book: 'D&C', chapter: 4, verse: 2, text: 'Therefore, O ye that embark in the service of God, see that ye serve him with all your heart, might, mind and strength, that ye may stand blameless before God at the last day.', volume: 'Doctrine and Covenants', reference: 'D&C 4:2' },
  { book: 'Moroni', chapter: 10, verse: 4, text: 'And when ye shall receive these things, I would exhort you that ye would ask God, the Eternal Father, in the name of Christ, if these things are not true; and if ye shall ask with a sincere heart, with real intent, having faith in Christ, he will manifest the truth of it unto you, by the power of the Holy Ghost.', volume: 'Book of Mormon', reference: 'Moroni 10:4' },
  { book: 'Mosiah', chapter: 2, verse: 17, text: 'When ye are in the service of your fellow beings ye are only in the service of your God.', volume: 'Book of Mormon', reference: 'Mosiah 2:17' },
  { book: 'D&C', chapter: 121, verse: 7, text: 'My son, peace be unto thy soul; thine adversity and thine afflictions shall be but a small moment.', volume: 'Doctrine and Covenants', reference: 'D&C 121:7' },
  { book: 'Joshua', chapter: 1, verse: 9, text: 'Be strong and of a good courage; be not afraid, neither be thou dismayed: for the Lord thy God is with thee whithersoever thou goest.', volume: 'Bible', reference: 'Joshua 1:9' },
  { book: 'Proverbs', chapter: 3, verse: 5, text: 'Trust in the Lord with all thine heart; and lean not unto thine own understanding.', volume: 'Bible', reference: 'Proverbs 3:5' },
  { book: 'Alma', chapter: 7, verse: 11, text: 'And he shall go forth, suffering pains and afflictions and temptations of every kind; and this that the word might be fulfilled which saith he will take upon him the pains and the sicknesses of his people.', volume: 'Book of Mormon', reference: 'Alma 7:11' },
  { book: '2 Nephi', chapter: 2, verse: 25, text: 'Adam fell that men might be; and men are, that they might have joy.', volume: 'Book of Mormon', reference: '2 Nephi 2:25' },
  { book: 'D&C', chapter: 84, verse: 88, text: 'And whoso receiveth you, there I will be also, for I will go before your face. I will be on your right hand and on your left, and my Spirit shall be in your hearts, and mine angels round about you, to bear you up.', volume: 'Doctrine and Covenants', reference: 'D&C 84:88' },
  { book: 'Moroni', chapter: 7, verse: 47, text: 'But charity is the pure love of Christ, and it endureth forever; and whoso is found possessed of it at the last day, it shall be well with him.', volume: 'Book of Mormon', reference: 'Moroni 7:47' },
  { book: 'Moses', chapter: 1, verse: 39, text: 'For behold, this is my work and my glory—to bring to pass the immortality and eternal life of man.', volume: 'Pearl of Great Price', reference: 'Moses 1:39' },
  { book: 'Philippians', chapter: 4, verse: 13, text: 'I can do all things through Christ which strengtheneth me.', volume: 'Bible', reference: 'Philippians 4:13' },
  { book: '3 Nephi', chapter: 27, verse: 27, text: 'Therefore, what manner of men ought ye to be? Verily I say unto you, even as I am.', volume: 'Book of Mormon', reference: '3 Nephi 27:27' },
  { book: 'Ether', chapter: 12, verse: 27, text: 'And if men come unto me I will show unto them their weakness. I give unto men weakness that they may be humble; and my grace is sufficient for all men that humble themselves before me; for if they humble themselves before me, and have faith in me, then will I make weak things become strong unto them.', volume: 'Book of Mormon', reference: 'Ether 12:27' },
  { book: 'D&C', chapter: 82, verse: 10, text: 'I, the Lord, am bound when ye do what I say; but when ye do not what I say, ye have no promise.', volume: 'Doctrine and Covenants', reference: 'D&C 82:10' },
  { book: 'Romans', chapter: 8, verse: 16, text: 'The Spirit itself beareth witness with our spirit, that we are the children of God.', volume: 'Bible', reference: 'Romans 8:16' },
  { book: 'Alma', chapter: 26, verse: 12, text: 'Yea, I know that I am nothing; as to my strength I am weak; therefore I will not boast of myself, but I will boast of my God, for in his strength I can do all things.', volume: 'Book of Mormon', reference: 'Alma 26:12' },
  { book: 'D&C', chapter: 58, verse: 27, text: 'Verily I say, men should be anxiously engaged in a good cause, and do many things of their own free will, and bring to pass much righteousness.', volume: 'Doctrine and Covenants', reference: 'D&C 58:27' },
];

async function seed() {
  try {
    console.log('🌱 Seeding database...');

    // Areas
    for (const area of areas) {
      await query(
        `INSERT INTO areas (name, continent) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [area.name, area.continent]
      );
    }
    console.log(`✅ ${areas.length} areas seeded`);

    // Africa West sample stake
    const areaResult = await query(`SELECT id FROM areas WHERE name = 'Africa West Area' LIMIT 1`);
    if (areaResult.rows.length > 0) {
      const areaId = areaResult.rows[0].id;
      const ccResult = await query(
        `INSERT INTO coordinating_councils (name, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
        ['Nigeria Coordinating Council', areaId]
      );
      if (ccResult.rows.length > 0) {
        const ccId = ccResult.rows[0].id;
        await query(
          `INSERT INTO stakes (name, country, city, coordinating_council_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          ['Abeokuta Nigeria Ibara Stake', 'Nigeria', 'Abeokuta', ccId]
        );
        await query(
          `INSERT INTO stakes (name, country, city, coordinating_council_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          ['Lagos Nigeria Stake', 'Nigeria', 'Lagos', ccId]
        );
        await query(
          `INSERT INTO stakes (name, country, city, coordinating_council_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          ['Abuja Nigeria Stake', 'Nigeria', 'Abuja', ccId]
        );
        // Nigeria Lagos Mission
        await query(
          `INSERT INTO missions (name, country, area_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          ['Nigeria Lagos Mission', 'Nigeria', areaId]
        );
        await query(
          `INSERT INTO missions (name, country, area_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          ['Nigeria Abuja Mission', 'Nigeria', areaId]
        );
        console.log('✅ Nigeria sample church structure seeded');
      }
    }

    // Scriptures
    for (const s of scriptures) {
      await query(
        `INSERT INTO scriptures (book, chapter, verse, text, volume, reference)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [s.book, s.chapter, s.verse, s.text, s.volume, s.reference]
      );
    }
    console.log(`✅ ${scriptures.length} scriptures seeded`);

    console.log('\n🎉 Seed complete!');
  } catch (err) {
    console.error('❌ Seed error:', err.message);
  } finally {
    await pool.end();
  }
}

seed();
