-- Add YSA pool support to districts table
ALTER TABLE districts ADD COLUMN IF NOT EXISTS ysa_pool_active BOOLEAN DEFAULT false;
