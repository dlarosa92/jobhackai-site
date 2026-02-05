-- Migration 013: Add has_seen_upgrade_popup flag to users table
-- Tracks whether the user has seen the free→paid upgrade popup (0 = not seen, 1 = seen)
--
-- Apply with:
-- wrangler d1 execute <database-name> --remote --file app/db/migrations/013_add_has_seen_upgrade_popup.sql
-- wrangler d1 execute DB --file app/db/migrations/013_add_has_seen_upgrade_popup.sql --env=dev
-- wrangler d1 execute DB --file app/db/migrations/013_add_has_seen_upgrade_popup.sql --env=qa
-- wrangler d1 execute DB --file app/db/migrations/013_add_has_seen_upgrade_popup.sql --env=prod
--
-- Rollback (manual):
-- ALTER TABLE users DROP COLUMN has_seen_upgrade_popup;

ALTER TABLE users ADD COLUMN has_seen_upgrade_popup INTEGER NOT NULL DEFAULT 0;
