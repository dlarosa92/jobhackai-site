-- Migration 019: Add Terms of Service and Privacy Policy acceptance tracking
-- Purpose: Track when users accept ToS and Privacy Policy for legal compliance
-- Date: 2026-02-28
--
-- SAFE TO RUN MULTIPLE TIMES: SQLite will error if column exists, but that's harmless

-- Terms of Service acceptance tracking
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE users ADD COLUMN terms_version TEXT;

-- Privacy Policy acceptance tracking
ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT;
ALTER TABLE users ADD COLUMN privacy_version TEXT;

-- Create index for compliance queries (finding users who accepted specific version)
CREATE INDEX IF NOT EXISTS idx_users_terms_version ON users(terms_version);
