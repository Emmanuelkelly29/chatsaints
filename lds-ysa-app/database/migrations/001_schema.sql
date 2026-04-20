-- ================================================================
-- LDS YSA CONNECT — FULL DATABASE SCHEMA
-- Run this file once to create all tables
-- ================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- ENUMS
-- ================================================================

CREATE TYPE user_status AS ENUM (
  'active',
  'missionary',
  'pending_approval',
  'suspended',
  'released_missionary'
);

CREATE TYPE leadership_role AS ENUM (
  'ysa_member',
  'ysa_rep',
  'ysa_couple_adviser',
  'bishop',
  'stake_presidency',
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

CREATE TYPE message_type AS ENUM (
  'text',
  'image',
  'video',
  'audio',
  'file',
  'document',
  'voice_note'
);

CREATE TYPE call_type AS ENUM ('voice', 'video');
CREATE TYPE call_status AS ENUM ('initiated', 'answered', 'declined', 'missed', 'ended');

-- ================================================================
-- GEOGRAPHIC HIERARCHY
-- ================================================================

CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,          -- e.g. "Africa West Area"
  continent VARCHAR(80),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coordinating_councils (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  area_id UUID REFERENCES areas(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,           -- e.g. "Abeokuta Nigeria Ibara Stake"
  country VARCHAR(80),
  coordinating_council_id UUID REFERENCES coordinating_councils(id),
  ysa_pool_active BOOLEAN DEFAULT FALSE, -- pool must be activated for cross-stake visibility
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE districts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  country VARCHAR(80),
  coordinating_council_id UUID REFERENCES coordinating_councils(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE wards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  stake_id UUID REFERENCES stakes(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  stake_id UUID REFERENCES stakes(id),         -- nullable if under district
  district_id UUID REFERENCES districts(id),   -- nullable if under stake
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- MISSIONS
-- ================================================================

CREATE TABLE missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,           -- e.g. "Nigeria Lagos Mission"
  area_id UUID REFERENCES areas(id),
  country VARCHAR(80),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- USERS
-- ================================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(150) UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  date_of_birth DATE,
  is_single BOOLEAN DEFAULT TRUE,
  profile_photo_url TEXT,
  bio TEXT,

  -- Role & status
  role leadership_role DEFAULT 'ysa_member',
  status user_status DEFAULT 'active',
  is_approved BOOLEAN DEFAULT FALSE,    -- leaders require peer approval
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,

  -- Church placement
  stake_id UUID REFERENCES stakes(id),
  district_id UUID REFERENCES districts(id),
  ward_id UUID REFERENCES wards(id),
  branch_id UUID REFERENCES branches(id),

  -- Missionary fields
  mission_id UUID REFERENCES missions(id),
  missionary_start_date DATE,
  missionary_end_date DATE,
  missionary_mode_active BOOLEAN DEFAULT FALSE,
  maas360_enrolled BOOLEAN DEFAULT FALSE,
  maas360_device_id VARCHAR(200),

  -- Mission president fields
  mission_president_mission_id UUID REFERENCES missions(id),
  spouse_id UUID REFERENCES users(id),  -- links wife to mission president

  -- Visibility & privacy
  profile_hidden BOOLEAN DEFAULT FALSE, -- true for area authority and above

  -- Tokens & notifications
  fcm_token TEXT,
  apns_token TEXT,

  -- Metadata
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- YSA STAKE POOL (cross-stake contact discovery)
-- ================================================================

CREATE TABLE stake_pool_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stake_id UUID REFERENCES stakes(id),
  added_by UUID REFERENCES users(id),   -- must be a YSA rep
  approved BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, stake_id)
);

-- ================================================================
-- CONVERSATIONS (1-on-1 and group)
-- ================================================================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200),                     -- null for 1-on-1
  is_group BOOLEAN DEFAULT FALSE,
  description TEXT,
  photo_url TEXT,
  created_by UUID REFERENCES users(id),
  max_members INTEGER DEFAULT 1000,

  -- Mission-scoped group flag
  mission_id UUID REFERENCES missions(id), -- if set, only that mission can join

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_admin BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE(conversation_id, user_id)
);

-- Pinned chats (max 3 per user)
CREATE TABLE pinned_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);

-- ================================================================
-- MESSAGES
-- ================================================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id),
  type message_type DEFAULT 'text',
  content TEXT,                          -- text body or caption
  media_url TEXT,                        -- s3/local url for media
  media_size_bytes BIGINT,
  media_duration_secs INTEGER,           -- for audio/video
  reply_to_message_id UUID REFERENCES messages(id),
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message read receipts
CREATE TABLE message_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- ================================================================
-- CALLS
-- ================================================================

CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  initiated_by UUID REFERENCES users(id),
  type call_type NOT NULL,
  status call_status DEFAULT 'initiated',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_secs INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE call_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  UNIQUE(call_id, user_id)
);

-- ================================================================
-- SCRIPTURE FEED
-- ================================================================

CREATE TABLE scriptures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book VARCHAR(80) NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  volume VARCHAR(60),   -- Book of Mormon, Doctrine & Covenants, Bible, Pearl of Great Price
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- LEADER APPROVAL QUEUE
-- ================================================================

CREATE TABLE leader_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id UUID REFERENCES users(id),
  reviewer_id UUID REFERENCES users(id),
  declared_role leadership_role,
  status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, rejected
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- ================================================================
-- INDEXES for performance
-- ================================================================

CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_stake ON users(stake_id);
CREATE INDEX idx_users_mission ON users(mission_id);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX idx_stake_pool_stake ON stake_pool_members(stake_id);
CREATE INDEX idx_scriptures_volume ON scriptures(volume);

-- ================================================================
-- AUTO-UPDATE updated_at trigger
-- ================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================================
-- STATUS FEATURE (WhatsApp-style 24-hour stories)
-- Added as migration 002
-- ================================================================

CREATE TYPE status_visibility AS ENUM (
  'everyone',        -- all contacts can see
  'contacts_only',   -- only people in your stake pool / conversation contacts
  'selected',        -- only specific user IDs you choose
  'except'           -- everyone except specific user IDs
);

CREATE TABLE statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url TEXT,                        -- image or video URL
  media_type VARCHAR(10) DEFAULT 'image', -- 'image' or 'video'
  caption TEXT,
  duration_secs INTEGER DEFAULT 5,       -- for video: actual duration; for image: display time
  visibility status_visibility DEFAULT 'contacts_only',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Who is allowed / blocked per status (for 'selected' and 'except' visibility)
CREATE TABLE status_visibility_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(status_id, user_id)
);

-- Who viewed a status — anonymous viewers are NOT stored if user opts for stealth
CREATE TABLE status_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  is_stealth BOOLEAN DEFAULT FALSE,      -- TRUE = viewer chose to stay hidden
  UNIQUE(status_id, viewer_id)
);

-- User-level setting: always view stealthily by default
ALTER TABLE users ADD COLUMN IF NOT EXISTS stealth_status_view BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_visibility_default status_visibility DEFAULT 'contacts_only';

CREATE INDEX idx_statuses_user ON statuses(user_id);
CREATE INDEX idx_statuses_expires ON statuses(expires_at);
CREATE INDEX idx_status_views_status ON status_views(status_id);
