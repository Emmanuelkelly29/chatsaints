require('dotenv').config();
const { query } = require('./src/config/database');

const scriptures = [
  // ── OLD TESTAMENT ──
  { book: 'Genesis', chapter: 1, verse: 1, text: 'In the beginning God created the heaven and the earth.', volume: 'Bible' },
  { book: 'Psalms', chapter: 23, verse: 1, text: 'The Lord is my shepherd; I shall not want.', volume: 'Bible' },
  { book: 'Proverbs', chapter: 3, verse: 5, text: 'Trust in the Lord with all thine heart; and lean not unto thine own understanding.', volume: 'Bible' },
  { book: 'Isaiah', chapter: 41, verse: 10, text: 'Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee.', volume: 'Bible' },
  { book: 'Jeremiah', chapter: 29, verse: 11, text: 'For I know the thoughts that I think toward you, saith the Lord, thoughts of peace, and not of evil, to give you an expected end.', volume: 'Bible' },
  { book: 'Psalms', chapter: 46, verse: 10, text: 'Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.', volume: 'Bible' },
  { book: 'Psalms', chapter: 37, verse: 5, text: 'Commit thy way unto the Lord; trust also in him; and he shall bring it to pass.', volume: 'Bible' },
  { book: 'Isaiah', chapter: 40, verse: 31, text: 'But they that wait upon the Lord shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and shall walk, and not faint.', volume: 'Bible' },
  { book: 'Psalms', chapter: 119, verse: 105, text: 'Thy word is a lamp unto my feet, and a light unto my path.', volume: 'Bible' },

  // ── NEW TESTAMENT ──
  { book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', volume: 'Bible' },
  { book: 'Matthew', chapter: 11, verse: 28, text: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.', volume: 'Bible' },
  { book: 'Philippians', chapter: 4, verse: 13, text: 'I can do all things through Christ which strengtheneth me.', volume: 'Bible' },
  { book: 'Romans', chapter: 8, verse: 28, text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.', volume: 'Bible' },
  { book: 'James', chapter: 1, verse: 5, text: 'If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.', volume: 'Bible' },
  { book: 'Hebrews', chapter: 12, verse: 1, text: 'Let us run with patience the race that is set before us.', volume: 'Bible' },
  { book: 'Matthew', chapter: 5, verse: 14, text: 'Ye are the light of the world. A city that is set on an hill cannot be hid.', volume: 'Bible' },
  { book: 'John', chapter: 14, verse: 27, text: 'Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid.', volume: 'Bible' },
  { book: '2 Timothy', chapter: 1, verse: 7, text: 'For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.', volume: 'Bible' },
  { book: 'Romans', chapter: 8, verse: 31, text: 'If God be for us, who can be against us?', volume: 'Bible' },

  // ── BOOK OF MORMON ──
  { book: '1 Nephi', chapter: 3, verse: 7, text: 'I will go and do the things which the Lord hath commanded, for I know that the Lord giveth no commandments unto the children of men, save he shall prepare a way for them that they may accomplish the thing which he commandeth them.', volume: 'Book of Mormon' },
  { book: '2 Nephi', chapter: 2, verse: 25, text: 'Adam fell that men might be; and men are, that they might have joy.', volume: 'Book of Mormon' },
  { book: '2 Nephi', chapter: 31, verse: 20, text: 'Wherefore, ye must press forward with a steadfastness in Christ, having a perfect brightness of hope, and a love of God and of all men.', volume: 'Book of Mormon' },
  { book: 'Mosiah', chapter: 2, verse: 17, text: 'When ye are in the service of your fellow beings ye are only in the service of your God.', volume: 'Book of Mormon' },
  { book: 'Mosiah', chapter: 4, verse: 27, text: 'And see that all these things are done in wisdom and order; for it is not requisite that a man should run faster than he has strength.', volume: 'Book of Mormon' },
  { book: 'Alma', chapter: 37, verse: 6, text: 'By small and simple things are great things brought to pass.', volume: 'Book of Mormon' },
  { book: 'Alma', chapter: 32, verse: 21, text: 'Faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.', volume: 'Book of Mormon' },
  { book: 'Moroni', chapter: 10, verse: 4, text: 'And when ye shall receive these things, I would exhort you that ye would ask God, the Eternal Father, in the name of Christ, if these things are not true; and if ye shall ask with a sincere heart, with real intent, having faith in Christ, he will manifest the truth of it unto you, by the power of the Holy Ghost.', volume: 'Book of Mormon' },
  { book: 'Moroni', chapter: 10, verse: 5, text: 'And by the power of the Holy Ghost ye may know the truth of all things.', volume: 'Book of Mormon' },
  { book: 'Ether', chapter: 12, verse: 27, text: 'And if men come unto me I will show unto them their weakness. I give unto men weakness that they may be humble; and my grace is sufficient for all men that humble themselves before me.', volume: 'Book of Mormon' },
  { book: 'Alma', chapter: 41, verse: 10, text: 'Wickedness never was happiness.', volume: 'Book of Mormon' },
  { book: '3 Nephi', chapter: 11, verse: 29, text: 'For verily, verily I say unto you, he that hath the spirit of contention is not of me, but is of the devil.', volume: 'Book of Mormon' },
  { book: 'Helaman', chapter: 5, verse: 12, text: 'And now, my sons, remember, remember that it is upon the rock of our Redeemer, who is Christ, the Son of God, that ye must build your foundation.', volume: 'Book of Mormon' },
  { book: '3 Nephi', chapter: 27, verse: 27, text: 'What manner of men ought ye to be? Verily I say unto you, even as I am.', volume: 'Book of Mormon' },

  // ── DOCTRINE AND COVENANTS ──
  { book: 'D&C', chapter: 6, verse: 36, text: 'Look unto me in every thought; doubt not, fear not.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 4, verse: 2, text: 'Therefore, O ye that embark in the service of God, see that ye serve him with all your heart, might, mind and strength, that ye may stand blameless before God at the last day.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 58, verse: 27, text: 'Verily I say, men should be anxiously engaged in a good cause, and do many things of their own free will, and bring to pass much righteousness.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 121, verse: 7, text: 'My son, peace be unto thy soul; thine adversity and thine afflictions shall be but a small moment.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 88, verse: 118, text: 'And as all have not faith, seek ye diligently and teach one another words of wisdom; yea, seek ye out of the best books words of wisdom; seek learning, even by study and also by faith.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 82, verse: 10, text: 'I, the Lord, am bound when ye do what I say; but when ye do not what I say, ye have no promise.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 10, verse: 5, text: 'Pray always, that you may come off conqueror; yea, that you may conquer Satan, and that you may escape the hands of the servants of Satan that do uphold his work.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 84, verse: 88, text: 'And whoso receiveth you, there I will be also, for I will go before your face. I will be on your right hand and on your left, and my Spirit shall be in your hearts, and mine angels round about you, to bear you up.', volume: 'Doctrine and Covenants' },
  { book: 'D&C', chapter: 123, verse: 17, text: 'Therefore, dearly beloved brethren, let us cheerfully do all things that lie in our power; and then may we stand still, with the utmost assurance, to see the salvation of God.', volume: 'Doctrine and Covenants' },

  // ── PEARL OF GREAT PRICE ──
  { book: 'Moses', chapter: 1, verse: 39, text: 'For behold, this is my work and my glory—to bring to pass the immortality and eternal life of man.', volume: 'Pearl of Great Price' },
  { book: 'Moses', chapter: 7, verse: 18, text: 'And the Lord called his people Zion, because they were of one heart and one mind, and dwelt in righteousness; and there was no poor among them.', volume: 'Pearl of Great Price' },
  { book: 'Abraham', chapter: 3, verse: 25, text: 'And we will prove them herewith, to see if they will do all things whatsoever the Lord their God shall command them.', volume: 'Pearl of Great Price' },
  { book: 'Joseph Smith—History', chapter: 1, verse: 17, text: 'I saw two Personages, whose brightness and glory defy all description, standing above me in the air. One of them spake unto me, calling me by name and said, pointing to the other—This is My Beloved Son. Hear Him!', volume: 'Pearl of Great Price' },
  { book: 'Articles of Faith', chapter: 1, verse: 13, text: 'We believe in being honest, true, chaste, benevolent, virtuous, and in doing good to all men.', volume: 'Pearl of Great Price' },
  { book: 'Articles of Faith', chapter: 1, verse: 3, text: 'We believe that through the Atonement of Christ, all mankind may be saved, by obedience to the laws and ordinances of the Gospel.', volume: 'Pearl of Great Price' },
  { book: 'Moses', chapter: 6, verse: 57, text: 'Wherefore teach it unto your children, that all men, everywhere, must repent, or they can in nowise inherit the kingdom of God.', volume: 'Pearl of Great Price' },
];

async function seed() {
  try {
    // Check if scriptures already exist
    const existing = await query('SELECT COUNT(*) FROM scriptures');
    const count = parseInt(existing.rows[0].count);
    if (count > 0) {
      console.log(`Scriptures table already has ${count} rows. Clearing and re-seeding...`);
      await query('DELETE FROM scriptures');
    }

    let inserted = 0;
    for (const s of scriptures) {
      await query(
        'INSERT INTO scriptures (book, chapter, verse, text, volume) VALUES ($1, $2, $3, $4, $5)',
        [s.book, s.chapter, s.verse, s.text, s.volume]
      );
      inserted++;
    }
    console.log(`Seeded ${inserted} scriptures from all 4 standard works:`);
    const volumes = await query('SELECT volume, COUNT(*) as cnt FROM scriptures GROUP BY volume ORDER BY volume');
    volumes.rows.forEach(r => console.log(`  ${r.volume}: ${r.cnt}`));
  } catch (err) {
    console.error('Seed error:', err.message);
  }
  process.exit();
}
seed();
