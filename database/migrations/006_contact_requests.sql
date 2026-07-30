DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'contact_request_preference'
  ) THEN
    CREATE TYPE contact_request_preference AS ENUM (
      'approved_pool',
      'same_stake',
      'nobody'
    );
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS contact_request_preference contact_request_preference DEFAULT 'approved_pool',
  ADD COLUMN IF NOT EXISTS directory_visible BOOLEAN DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intro_message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE(sender_id, recipient_id),
  CHECK (sender_id <> recipient_id)
);

CREATE TABLE IF NOT EXISTS contact_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID REFERENCES contact_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_low_id, user_high_id),
  CHECK (user_low_id <> user_high_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_requests_sender_status ON contact_requests(sender_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_requests_recipient_status ON contact_requests(recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_connections_low_high ON contact_connections(user_low_id, user_high_id);