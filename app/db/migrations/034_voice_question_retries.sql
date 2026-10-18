-- Migration: Voice "retry this question" allowance
-- Purpose: a free user may retry the weakest question of a scored free
--          session once, without using the lifetime credit. The primary key
--          is the parent session, so each session can be retried only once.
--          Only ids and timestamps are stored, never interview content.
-- Date: 2026-10-17
--
-- NOT APPLIED to any environment yet. The feature stays off until
-- VOICE_RETRY_ENABLED is 'true', and the session report skips the retry
-- offer while this table is missing.
--
-- Run per environment:
--   npx wrangler d1 execute jobhackai-dev-db  --remote --file=app/db/migrations/034_voice_question_retries.sql
--   npx wrangler d1 execute jobhackai-qa-db   --remote --file=app/db/migrations/034_voice_question_retries.sql
--   npx wrangler d1 execute jobhackai-prod-db --remote --file=app/db/migrations/034_voice_question_retries.sql

CREATE TABLE IF NOT EXISTS voice_question_retries (
  parent_session_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  claimed_at TEXT DEFAULT (datetime('now')),
  retry_session_id TEXT,
  completed_at TEXT,
  FOREIGN KEY (parent_session_id) REFERENCES voice_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voice_question_retries_user ON voice_question_retries(user_id);
