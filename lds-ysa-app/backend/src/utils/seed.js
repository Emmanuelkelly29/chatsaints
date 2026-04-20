/**
 * Database seed — creates sample LDS church structure and scriptures
 * Run with: npm run db:seed
 */
const prisma = require('../config/prisma');

const SCRIPTURES = [
  { volume: 'Book of Mormon', book: '1 Nephi', chapter: 3, verse: 7, reference: '1 Nephi 3:7',
    text: 'I will go and do the things which the Lord hath commanded, for I know that the Lord giveth no commandments unto the children of men, save he shall prepare a way for them that they may accomplish the thing which he commandeth them.' },
  { volume: 'Book of Mormon', book: 'Mosiah', chapter: 2, verse: 17, reference: 'Mosiah 2:17',
    text: 'And behold, I tell you these things that ye may learn wisdom; that ye may learn that when ye are in the service of your fellow beings ye are only in the service of your God.' },
  { volume: 'Doctrine and Covenants', book: 'D&C', chapter: 18, verse: 10, reference: 'D&C 18:10',
    text: 'Remember the worth of souls is great in the sight of God.' },
  { volume: 'Book of Mormon', book: 'Moroni', chapter: 10, verse: 4, reference: 'Moroni 10:4',
    text: 'And when ye shall receive these things, I would exhort you that ye would ask God, the Eternal Father, in the name of Christ, if these things are not true; and if ye shall ask with a sincere heart, with real intent, having faith in Christ, he will manifest the truth of it unto you, by the power of the Holy Ghost.' },
  { volume: 'Bible', book: 'John', chapter: 13, verse: 34, reference: 'John 13:34',
    text: 'A new commandment I give unto you, That ye love one another; as I have loved you, that ye also love one another.' },
  { volume: 'Bible', book: 'Proverbs', chapter: 3, verse: 5, reference: 'Proverbs 3:5',
    text: 'Trust in the Lord with all thine heart; and lean not unto thine own understanding.' },
  { volume: 'Book of Mormon', book: 'Alma', chapter: 37, verse: 35, reference: 'Alma 37:35',
    text: 'O, remember, my son, and learn wisdom in thy youth; yea, learn in thy youth to keep the commandments of God.' },
  { volume: 'Doctrine and Covenants', book: 'D&C', chapter: 4, verse: 2, reference: 'D&C 4:2',
    text: 'Therefore, O ye that embark in the service of God, see that ye serve him with all your heart, might, mind and strength, that ye may stand blameless before God at the last day.' },
  { volume: 'Pearl of Great Price', book: 'Joseph Smith—History', chapter: 1, verse: 17, reference: 'JS—H 1:17',
    text: 'This is My Beloved Son. Hear Him!' },
  { volume: 'Bible', book: 'Matthew', chapter: 5, verse: 16, reference: 'Matthew 5:16',
    text: 'Let your light so shine before men, that they may see your good works, and glorify your Father which is in heaven.' },
];

async function seed() {
  console.log('Seeding database...');

  // Create church area
  const area = await prisma.churchArea.upsert({
    where: { name: 'Africa West Area' },
    update: {},
    create: { name: 'Africa West Area', continent: 'Africa' }
  });

  // Create a coordinating council
  const council = await prisma.churchUnit.create({
    data: { name: 'Nigeria Coordinating Council', type: 'COORDINATING_COUNCIL', areaId: area.id }
  });

  // Create a stake
  const stake = await prisma.churchUnit.create({
    data: { name: 'Abeokuta Nigeria Ibara Stake', type: 'STAKE', areaId: area.id, parentId: council.id }
  });

  // Create a ward under the stake
  const ward = await prisma.churchUnit.create({
    data: { name: 'Ibara Ward', type: 'WARD', parentId: stake.id }
  });

  // Create YSA pool for the stake
  await prisma.ysaStakePool.upsert({
    where: { stakeId: stake.id },
    update: {},
    create: { stakeId: stake.id, poolName: 'Abeokuta Nigeria Ibara Stake YSA', isOpen: true }
  });

  // Create a mission
  const mission = await prisma.mission.create({
    data: { name: 'Nigeria Lagos Mission', areaId: area.id }
  });

  // Seed scriptures
  for (const s of SCRIPTURES) {
    await prisma.scripture.create({ data: s });
  }

  console.log('Seed complete!');
  console.log(`Area: ${area.name}`);
  console.log(`Stake: ${stake.name}`);
  console.log(`Mission: ${mission.name}`);
  console.log(`${SCRIPTURES.length} scriptures loaded`);
}

seed()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
