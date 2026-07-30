-- ================================================================
-- ANNOUNCEMENTS (church leader broadcast messages)
-- Leaders send jurisdiction-scoped announcements.
-- Recipients are determined by role hierarchy at send-time and
-- stored in announcement_recipients so the query is fast.
-- ================================================================

CREATE TABLE IF NOT EXISTS announcements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     UUID NOT NULL REFERENCES users(id),
  title         VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL,
  -- Scope columns — only the relevant ones are non-null
  scope         VARCHAR(40) NOT NULL DEFAULT 'global',
  -- 'global'   = apostle / first presidency / it_support → everyone
  -- 'area'     = area authority / area presidency → their area
  -- 'mission'  = mission president / wife → missionaries in their mission
  -- 'stake'    = bishop / stake_presidency → their stake
  -- 'district' = district_presidency → their district
  scope_id      UUID,          -- area_id / mission_id / stake_id / district_id
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Denormalized recipient list (populated at send-time)
CREATE TABLE IF NOT EXISTS announcement_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  UNIQUE(announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ann_recipients_user ON announcement_recipients(user_id, announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcements_sender ON announcements(sender_id, created_at DESC);
