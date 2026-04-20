-- ================================================================
-- MIGRATION 003 — Message Reactions, Group Management, Voice Notes
-- Run this after 001_schema.sql and 002_status.sql
-- ================================================================

-- Message reactions (emoji reactions like WhatsApp)
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- Group invitations (for large groups, leaders can invite members)
CREATE TABLE IF NOT EXISTS group_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES users(id),
  invited_user_id UUID NOT NULL REFERENCES users(id),
  status          VARCHAR(20) DEFAULT 'pending',  -- pending, accepted, declined
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  responded_at    TIMESTAMPTZ,
  UNIQUE(conversation_id, invited_user_id)
);

-- Group video call rooms (LiveKit room management)
CREATE TABLE IF NOT EXISTS video_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  room_name       VARCHAR(200) UNIQUE NOT NULL,
  created_by      UUID REFERENCES users(id),
  is_active       BOOLEAN DEFAULT TRUE,
  max_participants INTEGER DEFAULT 50,
  mission_id      UUID REFERENCES missions(id),  -- for missionary-scoped rooms
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS video_room_participants (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   UUID NOT NULL REFERENCES video_rooms(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at   TIMESTAMPTZ,
  UNIQUE(room_id, user_id)
);

-- Track which messages are voice notes with their durations
ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_duration_secs INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_voice_note BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS waveform_data TEXT; -- JSON array of amplitude points

-- Forward messages table
CREATE TABLE IF NOT EXISTS message_forwards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_message_id   UUID REFERENCES messages(id),
  new_message_id        UUID REFERENCES messages(id),
  forwarded_by          UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation group settings (for group admins)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS only_admins_can_message BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS only_admins_can_edit    BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_video_rooms_conv ON video_rooms(conversation_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user   ON message_reactions(user_id);
