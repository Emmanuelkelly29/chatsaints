-- ================================================================
-- MIGRATION 004 — End-to-End Encryption Key Storage (Signal Protocol)
-- Run after migrations 001, 002, 003
-- ================================================================

-- User identity key (one per user, updated on key rotation)
CREATE TABLE IF NOT EXISTS e2ee_identity_keys (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  registration_id      INTEGER NOT NULL,
  identity_key_public  TEXT NOT NULL,           -- base64-encoded public key
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Signed prekeys (rotated periodically by the client)
CREATE TABLE IF NOT EXISTS e2ee_signed_prekeys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id     INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  signature  TEXT NOT NULL,                    -- signed by identity key
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key_id)
);

-- One-time prekeys (consumed one per session start — single use)
CREATE TABLE IF NOT EXISTS e2ee_one_time_prekeys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id     INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key_id)
);

-- Offline encrypted message queue (sealed sender delivery)
-- Server stores ciphertext ONLY — cannot decrypt
CREATE TABLE IF NOT EXISTS e2ee_message_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext   TEXT NOT NULL,                  -- base64-encoded ciphertext
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_e2ee_otpk_user    ON e2ee_one_time_prekeys(user_id, used);
CREATE INDEX IF NOT EXISTS idx_e2ee_queue_recip  ON e2ee_message_queue(recipient_id);
CREATE INDEX IF NOT EXISTS idx_e2ee_signed_user  ON e2ee_signed_prekeys(user_id);
