-- ════════════════════════════════════════════════════
-- LDS YSA CHAT APP — FULL DATABASE SCHEMA
-- ════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fast name search

-- ─── ENUMS ───────────────────────────────────────────

CREATE TYPE user_role AS ENUM (
  'ysa_member',
  'ysa_rep',
  'ysa_adviser',
  'bishop',
  'stake_presidency',
  'district_presidency',
  'coordinating_council',
  'area_authority',
  'area_presidency',
  'general_authority',
  'apostle',
  'first_presidency',
  'mission_president',
  'mission_president_wife',
  'missionary'
);

CREATE TYPE account_status AS ENUM (
  'pending_approval',
  'active',
  'missionary_mode',
  'suspended',
  'released'
);

CREATE TYPE approval_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE message_type AS ENUM (
  'text',
  'image',
  'video',
  'audio',
  'file',
  'document',
  'voice_note',
  'system'
);

CREATE TYPE call_type AS ENUM ('voice', 'video');
CREATE TYPE call_status AS ENUM ('ringing', 'active', 'ended', 'missed', 'rejected');

-- ─── GEOGRAPHY / CHURCH STRUCTURE ────────────────────

CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,           -- e.g. "Africa West Area"
  continent VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coordinating_councils (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  area_id UUID REFERENCES areas(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stakes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,           -- e.g. "Abeokuta Nigeria Ibara Stake"
  country VARCHAR(100),
  city VARCHAR(100),
  coordinating_council_id UUID REFERENCES coordinating_councils(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE districts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  country VARCHAR(100),
  coordinating_council_id UUID REFERENCES coordinating_councils(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE wards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  stake_id UUID REFERENCES stakes(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  stake_id UUID REFERENCES stakes(id),      -- null if under district
  district_id UUID REFERENCES districts(id), -- null if under stake
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE missions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,           -- e.g. "Nigeria Lagos Mission"
  country VARCHAR(100),
  area_id UUID REFERENCES areas(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── USERS ───────────────────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  age INTEGER GENERATED ALWAYS AS (
    EXTRACT(YEAR FROM AGE(date_of_birth))::INTEGER
  ) STORED,
  gender VARCHAR(20),
  profile_photo_url TEXT,
  role user_role NOT NULL DEFAULT 'ysa_member',
  account_status account_status NOT NULL DEFAULT 'pending_approval',
  is_married BOOLEAN DEFAULT FALSE,

  -- Church placement
  stake_id UUID REFERENCES stakes(id),
  district_id UUID REFERENCES districts(id),
  ward_id UUID REFERENCES wards(id),
  branch_id UUID REFERENCES branches(id),
  area_id UUID REFERENCES areas(id),
  mission_id UUID REFERENCES missions(id),   -- set when missionary_mode

  -- Missionary fields
  mission_call_date DATE,
  mission_return_date DATE,
  pre_mission_role user_role,                -- stores role before mission, restored on return
  pre_mission_status account_status,
  maas360_device_id VARCHAR(255),

  -- Mission president wife link
  mission_president_user_id UUID REFERENCES users(id), -- for wife profile

  -- Metadata
  last_seen TIMESTAMPTZ,
  is_online BOOLEAN DEFAULT FALSE,
  push_token TEXT,                           -- FCM/APNs device token
  otp_code VARCHAR(6),
  otp_expires TIMESTAMPTZ,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_stake ON users(stake_id);
CREATE INDEX idx_users_mission ON users(mission_id);
CREATE INDEX idx_users_name_trgm ON users USING GIN(full_name gin_trgm_ops);
CREATE INDEX idx_users_status ON users(account_status);

-- ─── LEADER APPROVALS ────────────────────────────────

CREATE TABLE leader_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  applicant_id UUID REFERENCES users(id) NOT NULL,
  approver_id UUID REFERENCES users(id),
  role_requested user_role NOT NULL,
  status approval_status DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- ─── STAKE YSA CONTACT POOL ──────────────────────────

CREATE TABLE stake_ysa_pools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stake_id UUID REFERENCES stakes(id) UNIQUE NOT NULL,
  pool_name VARCHAR(255) NOT NULL,           -- e.g. "Abeokuta Nigeria Ibara Stake YSA"
  is_open BOOLEAN DEFAULT FALSE,             -- true = other stakes can see this pool
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pool_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pool_id UUID REFERENCES stake_ysa_pools(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  added_by UUID REFERENCES users(id),        -- the YSA rep who added them
  status approval_status DEFAULT 'pending',
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pool_id, user_id)
);

CREATE TABLE pool_access_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requesting_stake_id UUID REFERENCES stakes(id),
  target_stake_id UUID REFERENCES stakes(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requesting_stake_id, target_stake_id)
);

-- ─── CONVERSATIONS ───────────────────────────────────

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  is_group BOOLEAN DEFAULT FALSE,
  group_name VARCHAR(255),
  group_photo_url TEXT,
  created_by UUID REFERENCES users(id),
  max_members INTEGER DEFAULT 1000,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversation_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  is_admin BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  is_muted BOOLEAN DEFAULT FALSE,
  UNIQUE(conversation_id, user_id)
);

CREATE INDEX idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX idx_conv_members_conv ON conversation_members(conversation_id);

-- ─── MESSAGES ────────────────────────────────────────

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id),
  message_type message_type DEFAULT 'text',
  content TEXT,                              -- text content or file URL
  file_name VARCHAR(255),
  file_size INTEGER,
  mime_type VARCHAR(100),
  thumbnail_url TEXT,
  duration_seconds INTEGER,                  -- for audio/video
  reply_to_id UUID REFERENCES messages(id),  -- for quoted replies
  is_deleted BOOLEAN DEFAULT FALSE,
  is_edited BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_conv ON messages(conversation_id, sent_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);

CREATE TABLE message_receipts (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

-- ─── PINNED CHATS (max 3 per user) ───────────────────

CREATE TABLE pinned_chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);

-- ─── CALLS ───────────────────────────────────────────

CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id),
  initiated_by UUID REFERENCES users(id),
  call_type call_type NOT NULL,
  status call_status DEFAULT 'ringing',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE call_participants (
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  PRIMARY KEY(call_id, user_id)
);

-- ─── SCRIPTURES ───────────────────────────────────────

CREATE TABLE scriptures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book VARCHAR(100) NOT NULL,               -- e.g. "1 Nephi"
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  volume VARCHAR(50),                        -- "Book of Mormon", "D&C", "Bible", "Pearl of Great Price"
  reference VARCHAR(150)                     -- e.g. "1 Nephi 3:7"
);

CREATE INDEX idx_scriptures_volume ON scriptures(volume);

-- ─── NOTIFICATIONS ────────────────────────────────────

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  title VARCHAR(255),
  body TEXT,
  data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- ─── YSA PROGRAMS ────────────────────────────────────

CREATE TABLE ysa_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stake_id UUID REFERENCES stakes(id),
  program_type VARCHAR(50),                  -- 'gathering_place' or 'institute'
  name VARCHAR(255),
  description TEXT,
  schedule TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
