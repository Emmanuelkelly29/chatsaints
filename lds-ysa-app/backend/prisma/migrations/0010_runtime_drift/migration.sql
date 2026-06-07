-- ================================================================
-- MIGRATION 0010 - Runtime drift
-- Columns and enum values the backend code relies on, but which
-- were only ever added ad hoc to the old dev database.
-- Sources: src/config/database.js startup migrate(),
--          _migrate_status.js, _migrate_it_support.js,
--          and column usage in src/controllers.
-- ================================================================

-- Auth columns (authController inserts/reads these)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

-- Geography (geographyController updates continent on stakes/districts)
ALTER TABLE stakes ADD COLUMN IF NOT EXISTS continent VARCHAR(100);
ALTER TABLE districts ADD COLUMN IF NOT EXISTS continent VARCHAR(100);

-- Text statuses (statusController)
ALTER TABLE statuses ADD COLUMN IF NOT EXISTS text_content TEXT;
ALTER TABLE statuses ADD COLUMN IF NOT EXISTS background_color VARCHAR(20) DEFAULT '#0A1628';

-- Roles used by the code that are missing from the 001 enum
ALTER TYPE leadership_role ADD VALUE IF NOT EXISTS 'district_presidency';
ALTER TYPE leadership_role ADD VALUE IF NOT EXISTS 'ysa_adviser';
ALTER TYPE leadership_role ADD VALUE IF NOT EXISTS 'it_support';
