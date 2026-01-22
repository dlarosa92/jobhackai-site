-- Migration 012: Add has_seen_welcome_modal flag to users table
-- Date: 2025-01-XX
-- Description: This tracks whether a user has seen the premium welcome modal
-- Stored server-side to persist across cache clears and devices
--
-- This migration adds an INTEGER column (SQLite boolean) to explicitly track
-- whether the welcome modal has been shown to a user. The column defaults to 0
-- (not seen) and is set to 1 when the user dismisses the modal.
--
-- To run this migration:
-- wrangler d1 execute <database-name> --remote --file app/db/migrations/012_add_has_seen_welcome_modal.sql
--
-- For each environment:
-- wrangler d1 execute DB --file app/db/migrations/012_add_has_seen_welcome_modal.sql --env=dev
-- wrangler d1 execute DB --file app/db/migrations/012_add_has_seen_welcome_modal.sql --env=qa
-- wrangler d1 execute DB --file app/db/migrations/012_add_has_seen_welcome_modal.sql --env=prod
--
-- Rollback (if needed):
-- ALTER TABLE users DROP COLUMN has_seen_welcome_modal;
-- DROP INDEX IF EXISTS idx_users_has_seen_welcome_modal;

-- Add the has_seen_welcome_modal column
ALTER TABLE users ADD COLUMN has_seen_welcome_modal INTEGER NOT NULL DEFAULT 0;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_has_seen_welcome_modal ON users(has_seen_welcome_modal);

-- Update existing users: if they have a plan other than 'free', they've likely seen the modal
-- This prevents re-showing the modal to existing premium users after migration
UPDATE users SET has_seen_welcome_modal = 1 
WHERE plan IN ('trial', 'essential', 'pro', 'premium');
