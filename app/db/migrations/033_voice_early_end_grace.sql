-- Migration: Voice early-end grace
-- Purpose: a candidate who ends a free or pack voice interview within the
--          first 2 minutes gets that session's credit back, once per account.
--          voice_grace_session_id records which session used the grace, so
--          it cannot be claimed twice. Subscriptions are not affected.
-- Date: 2026-10-17
--
-- NOT APPLIED to any environment yet. Apply before deploying the copy that
-- announces the rule. Until it runs, restoreEarlyEndCredit returns false and
-- every session keeps its credit, exactly as before.
-- SQLite doesn't support IF NOT EXISTS for ADD COLUMN; running twice will error.
--
-- Run per environment:
--   npx wrangler d1 execute jobhackai-dev-db  --remote --file=app/db/migrations/033_voice_early_end_grace.sql
--   npx wrangler d1 execute jobhackai-qa-db   --remote --file=app/db/migrations/033_voice_early_end_grace.sql
--   npx wrangler d1 execute jobhackai-prod-db --remote --file=app/db/migrations/033_voice_early_end_grace.sql

ALTER TABLE users ADD COLUMN voice_grace_session_id TEXT;
ALTER TABLE users ADD COLUMN voice_grace_used_at TEXT;
