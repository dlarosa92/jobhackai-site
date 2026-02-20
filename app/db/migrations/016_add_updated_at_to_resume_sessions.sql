-- Add updated_at to resume_sessions so the retention cleaner can distinguish
-- actively-used ATS sessions from truly stale ones.
-- upsertResumeSessionWithScores reuses old rows without creating feedback_sessions,
-- so created_at alone is not a reliable staleness signal.
--
-- NOTE: ALTER TABLE ADD COLUMN in SQLite/D1 does not support expression defaults
-- like (datetime('now')). We use NULL as the default here; application code
-- (upsertResumeSessionWithScores, updateResumeSessionAtsScore) sets
-- updated_at = datetime('now') on every write. The CREATE TABLE in schema.sql
-- uses the expression default for fresh databases where it IS valid.

ALTER TABLE resume_sessions ADD COLUMN updated_at TEXT;

-- Backfill existing rows: set updated_at = created_at so nothing looks artificially fresh
UPDATE resume_sessions SET updated_at = created_at WHERE updated_at IS NULL;
