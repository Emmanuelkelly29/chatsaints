-- ================================================================
-- SEED DATA — Areas, sample stakes, sample scriptures
-- ================================================================

-- AREAS
INSERT INTO areas (id, name, continent) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Africa West Area', 'Africa'),
  ('a1000000-0000-0000-0000-000000000002', 'Africa Central and South Area', 'Africa'),
  ('a1000000-0000-0000-0000-000000000003', 'Africa Southeast Area', 'Africa'),
  ('a1000000-0000-0000-0000-000000000004', 'North America West Area', 'North America'),
  ('a1000000-0000-0000-0000-000000000005', 'Europe Area', 'Europe'),
  ('a1000000-0000-0000-0000-000000000006', 'Asia Area', 'Asia'),
  ('a1000000-0000-0000-0000-000000000007', 'Pacific Area', 'Oceania'),
  ('a1000000-0000-0000-0000-000000000008', 'South America North Area', 'South America')
ON CONFLICT DO NOTHING;

-- COORDINATING COUNCILS (Nigeria under Africa West)
INSERT INTO coordinating_councils (id, name, area_id) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Nigeria Coordinating Council',
   'a1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', 'Ghana Coordinating Council',
   'a1000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- STAKES
INSERT INTO stakes (id, name, country, coordinating_council_id, ysa_pool_active) VALUES
  ('s1000000-0000-0000-0000-000000000001', 'Abeokuta Nigeria Ibara Stake',
   'Nigeria', 'c1000000-0000-0000-0000-000000000001', TRUE),
  ('s1000000-0000-0000-0000-000000000002', 'Lagos Nigeria Ikeja Stake',
   'Nigeria', 'c1000000-0000-0000-0000-000000000001', TRUE),
  ('s1000000-0000-0000-0000-000000000003', 'Accra Ghana Stake',
   'Ghana', 'c1000000-0000-0000-0000-000000000002', FALSE)
ON CONFLICT DO NOTHING;

-- MISSIONS
INSERT INTO missions (id, name, area_id, country) VALUES
  ('m1000000-0000-0000-0000-000000000001', 'Nigeria Lagos Mission',
   'a1000000-0000-0000-0000-000000000001', 'Nigeria'),
  ('m1000000-0000-0000-0000-000000000002', 'Nigeria Enugu Mission',
   'a1000000-0000-0000-0000-000000000001', 'Nigeria'),
  ('m1000000-0000-0000-0000-000000000003', 'Ghana Accra Mission',
   'a1000000-0000-0000-0000-000000000001', 'Ghana')
ON CONFLICT DO NOTHING;

-- SCRIPTURES (sample from each LDS volume)
INSERT INTO scriptures (book, chapter, verse, text, volume) VALUES
  ('1 Nephi', 3, 7,
   'And it came to pass that I, Nephi, said unto my father: I will go and do the things which the Lord hath commanded, for I know that the Lord giveth no commandments unto the children of men, save he shall prepare a way for them that they may accomplish the thing which he commandeth them.',
   'Book of Mormon'),
  ('Mosiah', 2, 17,
   'And behold, I tell you these things that ye may learn wisdom; that ye may learn that when ye are in the service of your fellow beings ye are only in the service of your God.',
   'Book of Mormon'),
  ('Alma', 37, 6,
   'Now ye may suppose that this is foolishness in me; but behold I say unto you, that by small and simple things are great things brought to pass.',
   'Book of Mormon'),
  ('Moroni', 10, 4,
   'And when ye shall receive these things, I would exhort you that ye would ask God, the Eternal Father, in the name of Christ, if these things are not true; and if ye shall ask with a sincere heart, with real intent, having faith in Christ, he will manifest the truth of it unto you, by the power of the Holy Ghost.',
   'Book of Mormon'),
  ('Doctrine and Covenants', 1, 38,
   'What I the Lord have spoken, I have spoken, and I excuse not myself; and though the heavens and the earth pass away, my word shall not pass away, but shall all be fulfilled, whether by mine own voice or by the voice of my servants, it is the same.',
   'Doctrine and Covenants'),
  ('Doctrine and Covenants', 4, 2,
   'Therefore, O ye that embark in the service of God, see that ye serve him with all your heart, might, mind and strength, that ye may stand blameless before God at the last day.',
   'Doctrine and Covenants'),
  ('Doctrine and Covenants', 58, 27,
   'Verily I say, men should be anxiously engaged in a good cause, and do many things of their own free will, and bring to pass much righteousness.',
   'Doctrine and Covenants'),
  ('John', 13, 34,
   'A new commandment I give unto you, That ye love one another; as I have loved you, that ye also love one another.',
   'Bible'),
  ('Joshua', 1, 9,
   'Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the Lord thy God is with thee whithersoever thou goest.',
   'Bible'),
  ('Proverbs', 3, 5,
   'Trust in the Lord with all thine heart; and lean not unto thine own understanding.',
   'Bible'),
  ('Matthew', 5, 14,
   'Ye are the light of the world. A city that is set on an hill cannot be hid.',
   'Bible'),
  ('Moses', 1, 39,
   'For behold, this is my work and my glory—to bring to pass the immortality and eternal life of man.',
   'Pearl of Great Price'),
  ('Abraham', 3, 25,
   'And we will prove them herewith, to see if they will do all things whatsoever the Lord their God shall command them.',
   'Pearl of Great Price'),
  ('Articles of Faith', 1, 13,
   'We believe in being honest, true, chaste, benevolent, virtuous, and in doing good to all men; indeed, we may say that we follow the admonition of Paul—We believe all things, we hope all things, we have endured many things, and hope to be able to endure all things. If there is anything virtuous, lovely, or of good report or praiseworthy, we seek after these things.',
   'Pearl of Great Price')
ON CONFLICT DO NOTHING;
