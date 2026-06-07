-- ================================================================
-- LDS YSA CONNECT - MEETING / CONFERENCE CALL SYSTEM
-- Run after 004_e2ee.sql
-- ================================================================

CREATE TYPE meeting_status AS ENUM ('waiting', 'active', 'ended');
CREATE TYPE meeting_role   AS ENUM ('host', 'co_host', 'presenter', 'attendee');
CREATE TYPE join_req_status AS ENUM ('pending', 'approved', 'rejected');

-- ── Core meeting room ─────────────────────────────────────────────
CREATE TABLE meetings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id          UUID NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL,
  description      TEXT,
  meeting_code     VARCHAR(12) UNIQUE NOT NULL,   -- e.g. "123-456-789"
  join_key         VARCHAR(100),                  -- optional password (hashed)
  requires_approval BOOLEAN DEFAULT FALSE,
  allow_link_join  BOOLEAN DEFAULT TRUE,          -- shareable link enabled
  max_participants INT DEFAULT 1000,
  status           meeting_status DEFAULT 'waiting',
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Participants currently in (or who were in) the meeting ─────────
CREATE TABLE meeting_participants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  role        meeting_role DEFAULT 'attendee',
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  left_at     TIMESTAMPTZ,
  is_muted    BOOLEAN DEFAULT FALSE,
  hand_raised BOOLEAN DEFAULT FALSE,
  UNIQUE(meeting_id, user_id)
);

-- ── Approval queue (requires_approval = true) ─────────────────────
CREATE TABLE meeting_join_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  status       join_req_status DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  UNIQUE(meeting_id, user_id)
);

-- ── Indexes ────────────────────────────────────────────────────────
CREATE INDEX ON meetings(meeting_code);
CREATE INDEX ON meetings(host_id);
CREATE INDEX ON meetings(status);
CREATE INDEX ON meeting_participants(meeting_id);
CREATE INDEX ON meeting_participants(user_id);
CREATE INDEX ON meeting_join_requests(meeting_id, status);
