-- ================================================================
-- GLOBAL DEMO DIRECTORY
-- 10 stakes, 10 districts, 20 approved YSA users across continents
-- Shared password for all demo accounts: Welcome123!
-- ================================================================

-- AREAS
INSERT INTO areas (id, name, continent) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Africa West Area', 'Africa'),
  ('a1000000-0000-0000-0000-000000000002', 'Africa Central and South Area', 'Africa'),
  ('a1000000-0000-0000-0000-000000000006', 'Asia Area', 'Asia'),
  ('a1000000-0000-0000-0000-000000000007', 'Pacific Area', 'Oceania'),
  ('a2000000-0000-0000-0000-000000000001', 'North America Central Area', 'North America'),
  ('a2000000-0000-0000-0000-000000000002', 'South America South Area', 'South America'),
  ('a2000000-0000-0000-0000-000000000003', 'Europe Central Area', 'Europe'),
  ('a2000000-0000-0000-0000-000000000004', 'Asia North Area', 'Asia'),
  ('a2000000-0000-0000-0000-000000000005', 'Pacific Islands Area', 'Oceania')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    continent = EXCLUDED.continent;

-- COORDINATING COUNCILS
INSERT INTO coordinating_councils (id, name, area_id) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Nigeria Coordinating Council', 'a1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', 'Ghana Coordinating Council', 'a1000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-000000000001', 'United States Coordinating Council', 'a2000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-000000000002', 'Canada Coordinating Council', 'a2000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-000000000003', 'Mexico Coordinating Council', 'a2000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-000000000004', 'Brazil Coordinating Council', 'a2000000-0000-0000-0000-000000000002'),
  ('c2000000-0000-0000-0000-000000000005', 'Argentina Coordinating Council', 'a2000000-0000-0000-0000-000000000002'),
  ('c2000000-0000-0000-0000-000000000006', 'United Kingdom Coordinating Council', 'a2000000-0000-0000-0000-000000000003'),
  ('c2000000-0000-0000-0000-000000000007', 'South Africa Coordinating Council', 'a1000000-0000-0000-0000-000000000002'),
  ('c2000000-0000-0000-0000-000000000008', 'India Coordinating Council', 'a1000000-0000-0000-0000-000000000006'),
  ('c2000000-0000-0000-0000-000000000009', 'Philippines Coordinating Council', 'a1000000-0000-0000-0000-000000000006'),
  ('c2000000-0000-0000-0000-000000000010', 'Japan Coordinating Council', 'a2000000-0000-0000-0000-000000000004'),
  ('c2000000-0000-0000-0000-000000000011', 'Australia Coordinating Council', 'a1000000-0000-0000-0000-000000000007'),
  ('c2000000-0000-0000-0000-000000000012', 'New Zealand Coordinating Council', 'a2000000-0000-0000-0000-000000000005')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    area_id = EXCLUDED.area_id;

-- STAKES
INSERT INTO stakes (id, name, country, coordinating_council_id, ysa_pool_active) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'Salt Lake Utah YSA Stake', 'United States', 'c2000000-0000-0000-0000-000000000001', TRUE),
  ('e2000000-0000-0000-0000-000000000002', 'Toronto Ontario YSA Stake', 'Canada', 'c2000000-0000-0000-0000-000000000002', TRUE),
  ('e2000000-0000-0000-0000-000000000003', 'Mexico City Chapultepec Stake', 'Mexico', 'c2000000-0000-0000-0000-000000000003', TRUE),
  ('e2000000-0000-0000-0000-000000000004', 'Sao Paulo Vila Mariana Stake', 'Brazil', 'c2000000-0000-0000-0000-000000000004', TRUE),
  ('e2000000-0000-0000-0000-000000000005', 'Buenos Aires Palermo Stake', 'Argentina', 'c2000000-0000-0000-0000-000000000005', TRUE),
  ('e2000000-0000-0000-0000-000000000006', 'London Hyde Park Stake', 'United Kingdom', 'c2000000-0000-0000-0000-000000000006', TRUE),
  ('e2000000-0000-0000-0000-000000000007', 'Johannesburg Sandton Stake', 'South Africa', 'c2000000-0000-0000-0000-000000000007', TRUE),
  ('e2000000-0000-0000-0000-000000000008', 'Manila Quezon City Stake', 'Philippines', 'c2000000-0000-0000-0000-000000000009', TRUE),
  ('e2000000-0000-0000-0000-000000000009', 'Tokyo Setagaya Stake', 'Japan', 'c2000000-0000-0000-0000-000000000010', TRUE),
  ('e2000000-0000-0000-0000-000000000010', 'Sydney Harbour Stake', 'Australia', 'c2000000-0000-0000-0000-000000000011', TRUE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    country = EXCLUDED.country,
    coordinating_council_id = EXCLUDED.coordinating_council_id,
    ysa_pool_active = EXCLUDED.ysa_pool_active;

-- DISTRICTS
INSERT INTO districts (id, name, country, coordinating_council_id, ysa_pool_active) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'Nairobi Kenya District', 'Kenya', 'c1000000-0000-0000-0000-000000000001', TRUE),
  ('d2000000-0000-0000-0000-000000000002', 'Accra Tema District', 'Ghana', 'c1000000-0000-0000-0000-000000000002', TRUE),
  ('d2000000-0000-0000-0000-000000000003', 'Bengaluru India District', 'India', 'c2000000-0000-0000-0000-000000000008', TRUE),
  ('d2000000-0000-0000-0000-000000000004', 'Frankfurt Germany District', 'Germany', 'c2000000-0000-0000-0000-000000000006', TRUE),
  ('d2000000-0000-0000-0000-000000000005', 'Santiago Chile District', 'Chile', 'c2000000-0000-0000-0000-000000000005', TRUE),
  ('d2000000-0000-0000-0000-000000000006', 'Lima Peru District', 'Peru', 'c2000000-0000-0000-0000-000000000004', TRUE),
  ('d2000000-0000-0000-0000-000000000007', 'Auckland New Zealand District', 'New Zealand', 'c2000000-0000-0000-0000-000000000012', TRUE),
  ('d2000000-0000-0000-0000-000000000008', 'Suva Fiji District', 'Fiji', 'c2000000-0000-0000-0000-000000000012', TRUE),
  ('d2000000-0000-0000-0000-000000000009', 'Kampala Uganda District', 'Uganda', 'c1000000-0000-0000-0000-000000000001', TRUE),
  ('d2000000-0000-0000-0000-000000000010', 'Paris France District', 'France', 'c2000000-0000-0000-0000-000000000006', TRUE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    country = EXCLUDED.country,
    coordinating_council_id = EXCLUDED.coordinating_council_id,
    ysa_pool_active = EXCLUDED.ysa_pool_active;

-- DEMO YSA USERS
WITH password_seed AS (
  SELECT crypt('Welcome123!', gen_salt('bf', 12)) AS password_hash
)
INSERT INTO users (
  id,
  phone_number,
  email,
  full_name,
  date_of_birth,
  is_single,
  bio,
  role,
  status,
  is_approved,
  stake_id,
  district_id,
  password_hash,
  profile_hidden
)
SELECT * FROM (
  SELECT
    'b2000000-0000-0000-0000-000000000001'::uuid,
    '+18015550101',
    'amara.jensen@chatsaints.demo',
    'Amara Jensen',
    '2000-04-12'::date,
    TRUE,
    'YSA from Salt Lake City, United States.',
    'ysa_member'::leadership_role,
    'active'::user_status,
    TRUE,
    'e2000000-0000-0000-0000-000000000001'::uuid,
    'd2000000-0000-0000-0000-000000000001'::uuid,
    password_seed.password_hash,
    FALSE
  FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000002'::uuid, '+18015550102', 'noah.carter@chatsaints.demo', 'Noah Carter', '1998-11-03'::date, TRUE, 'YSA from Salt Lake City, United States.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000001'::uuid, 'd2000000-0000-0000-0000-000000000010'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000003'::uuid, '+14165550103', 'grace.wilson@chatsaints.demo', 'Grace Wilson', '2001-01-19'::date, TRUE, 'YSA from Toronto, Canada.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000002'::uuid, 'd2000000-0000-0000-0000-000000000004'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000004'::uuid, '+14165550104', 'liam.bennett@chatsaints.demo', 'Liam Bennett', '1999-07-08'::date, TRUE, 'YSA from Toronto, Canada.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000002'::uuid, 'd2000000-0000-0000-0000-000000000007'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000005'::uuid, '+5255550105', 'sofia.ortega@chatsaints.demo', 'Sofia Ortega', '2002-03-22'::date, TRUE, 'YSA from Mexico City, Mexico.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000003'::uuid, 'd2000000-0000-0000-0000-000000000005'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000006'::uuid, '+5255550106', 'mateo.ruiz@chatsaints.demo', 'Mateo Ruiz', '1997-09-10'::date, TRUE, 'YSA from Mexico City, Mexico.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000003'::uuid, 'd2000000-0000-0000-0000-000000000006'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000007'::uuid, '+55115550107', 'isabela.silva@chatsaints.demo', 'Isabela Silva', '2000-08-27'::date, TRUE, 'YSA from Sao Paulo, Brazil.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000004'::uuid, 'd2000000-0000-0000-0000-000000000006'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000008'::uuid, '+55115550108', 'gabriel.costa@chatsaints.demo', 'Gabriel Costa', '1998-02-14'::date, TRUE, 'YSA from Sao Paulo, Brazil.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000004'::uuid, 'd2000000-0000-0000-0000-000000000008'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000009'::uuid, '+54115550109', 'valentina.lopez@chatsaints.demo', 'Valentina Lopez', '2001-06-05'::date, TRUE, 'YSA from Buenos Aires, Argentina.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000005'::uuid, 'd2000000-0000-0000-0000-000000000005'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000010'::uuid, '+54115550110', 'benjamin.farias@chatsaints.demo', 'Benjamin Farias', '1999-12-30'::date, TRUE, 'YSA from Buenos Aires, Argentina.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000005'::uuid, 'd2000000-0000-0000-0000-000000000009'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000011'::uuid, '+44205550111', 'charlotte.reed@chatsaints.demo', 'Charlotte Reed', '2000-10-01'::date, TRUE, 'YSA from London, United Kingdom.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000006'::uuid, 'd2000000-0000-0000-0000-000000000010'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000012'::uuid, '+44205550112', 'oliver.hughes@chatsaints.demo', 'Oliver Hughes', '1998-05-17'::date, TRUE, 'YSA from London, United Kingdom.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000006'::uuid, 'd2000000-0000-0000-0000-000000000004'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000013'::uuid, '+27115550113', 'thandi.mokoena@chatsaints.demo', 'Thandi Mokoena', '1997-04-09'::date, TRUE, 'YSA from Johannesburg, South Africa.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000007'::uuid, 'd2000000-0000-0000-0000-000000000009'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000014'::uuid, '+27115550114', 'siya.dlamini@chatsaints.demo', 'Siya Dlamini', '2002-02-25'::date, TRUE, 'YSA from Johannesburg, South Africa.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000007'::uuid, 'd2000000-0000-0000-0000-000000000001'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000015'::uuid, '+63915550115', 'michelle.reyes@chatsaints.demo', 'Michelle Reyes', '2001-09-13'::date, TRUE, 'YSA from Manila, Philippines.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000008'::uuid, 'd2000000-0000-0000-0000-000000000003'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000016'::uuid, '+63915550116', 'daniel.santos@chatsaints.demo', 'Daniel Santos', '1999-01-24'::date, TRUE, 'YSA from Manila, Philippines.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000008'::uuid, 'd2000000-0000-0000-0000-000000000008'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000017'::uuid, '+8135550117', 'yuki.tanaka@chatsaints.demo', 'Yuki Tanaka', '2000-07-02'::date, TRUE, 'YSA from Tokyo, Japan.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000009'::uuid, 'd2000000-0000-0000-0000-000000000003'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000018'::uuid, '+8135550118', 'haruto.sato@chatsaints.demo', 'Haruto Sato', '1998-06-11'::date, TRUE, 'YSA from Tokyo, Japan.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000009'::uuid, 'd2000000-0000-0000-0000-000000000010'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000019'::uuid, '+61255550119', 'ava.walker@chatsaints.demo', 'Ava Walker', '2001-11-28'::date, TRUE, 'YSA from Sydney, Australia.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000010'::uuid, 'd2000000-0000-0000-0000-000000000007'::uuid, password_seed.password_hash, FALSE FROM password_seed
  UNION ALL SELECT 'b2000000-0000-0000-0000-000000000020'::uuid, '+61255550120', 'lucas.harris@chatsaints.demo', 'Lucas Harris', '1997-03-15'::date, TRUE, 'YSA from Sydney, Australia.', 'ysa_member'::leadership_role, 'active'::user_status, TRUE, 'e2000000-0000-0000-0000-000000000010'::uuid, 'd2000000-0000-0000-0000-000000000008'::uuid, password_seed.password_hash, FALSE FROM password_seed
) AS demo_users (
  id,
  phone_number,
  email,
  full_name,
  date_of_birth,
  is_single,
  bio,
  role,
  status,
  is_approved,
  stake_id,
  district_id,
  password_hash,
  profile_hidden
)
ON CONFLICT (id) DO UPDATE
SET phone_number = EXCLUDED.phone_number,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    date_of_birth = EXCLUDED.date_of_birth,
    is_single = EXCLUDED.is_single,
    bio = EXCLUDED.bio,
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    is_approved = EXCLUDED.is_approved,
    stake_id = EXCLUDED.stake_id,
    district_id = EXCLUDED.district_id,
    password_hash = EXCLUDED.password_hash,
    profile_hidden = EXCLUDED.profile_hidden,
    updated_at = NOW();

-- APPROVED STAKE POOL MEMBERSHIPS FOR ALL DEMO YSA USERS
INSERT INTO stake_pool_members (id, user_id, stake_id, added_by, approved, approved_at) VALUES
  ('f2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000003', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000004', 'e2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000004', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000005', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-000000000006', 'e2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000006', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-000000000007', 'e2000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000007', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000008', 'b2000000-0000-0000-0000-000000000008', 'e2000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000008', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000009', 'b2000000-0000-0000-0000-000000000009', 'e2000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000009', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000010', 'b2000000-0000-0000-0000-000000000010', 'e2000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000010', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000011', 'b2000000-0000-0000-0000-000000000011', 'e2000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-000000000011', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000012', 'b2000000-0000-0000-0000-000000000012', 'e2000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-000000000012', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000013', 'b2000000-0000-0000-0000-000000000013', 'e2000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-000000000013', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000014', 'b2000000-0000-0000-0000-000000000014', 'e2000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-000000000014', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000015', 'b2000000-0000-0000-0000-000000000015', 'e2000000-0000-0000-0000-000000000008', 'b2000000-0000-0000-0000-000000000015', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000016', 'b2000000-0000-0000-0000-000000000016', 'e2000000-0000-0000-0000-000000000008', 'b2000000-0000-0000-0000-000000000016', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000017', 'b2000000-0000-0000-0000-000000000017', 'e2000000-0000-0000-0000-000000000009', 'b2000000-0000-0000-0000-000000000017', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000018', 'b2000000-0000-0000-0000-000000000018', 'e2000000-0000-0000-0000-000000000009', 'b2000000-0000-0000-0000-000000000018', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000019', 'b2000000-0000-0000-0000-000000000019', 'e2000000-0000-0000-0000-000000000010', 'b2000000-0000-0000-0000-000000000019', TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000020', 'b2000000-0000-0000-0000-000000000020', 'e2000000-0000-0000-0000-000000000010', 'b2000000-0000-0000-0000-000000000020', TRUE, NOW())
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    stake_id = EXCLUDED.stake_id,
    added_by = EXCLUDED.added_by,
    approved = EXCLUDED.approved,
    approved_at = EXCLUDED.approved_at;