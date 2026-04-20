-- ================================================================
-- MIGRATION 002 — STATUS FEATURE
-- Run this in pgAdmin if you already ran 001_schema.sql
-- ================================================================

CREATE TYPE IF NOT EXISTS status_visibility AS ENUM (
  'everyone', 'contacts_only', 'selected', 'except'
);

CREATE TABLE IF NOT EXISTS statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url TEXT,
  media_type VARCHAR(10) DEFAULT 'image',
  caption TEXT,
  duration_secs INTEGER DEFAULT 5,
  visibility status_visibility DEFAULT 'contacts_only',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_visibility_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(status_id, user_id)
);

CREATE TABLE IF NOT EXISTS status_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  is_stealth BOOLEAN DEFAULT FALSE,
  UNIQUE(status_id, viewer_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS stealth_status_view BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_visibility_default status_visibility DEFAULT 'contacts_only';

CREATE INDEX IF NOT EXISTS idx_statuses_user ON statuses(user_id);
CREATE INDEX IF NOT EXISTS idx_statuses_expires ON statuses(expires_at);
CREATE INDEX IF NOT EXISTS idx_status_views_status ON status_views(status_id);
