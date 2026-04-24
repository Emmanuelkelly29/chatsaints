-- Migration 006: Add audience column to announcements
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience TEXT DEFAULT '["all"]';
