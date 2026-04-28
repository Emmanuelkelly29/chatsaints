-- Migration 007: Add gender column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10);
