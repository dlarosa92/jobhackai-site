-- Add updated_at to resume_sessions so the retention cleaner can distinguish
-- actively-used ATS sessions from truly stale ones.
-- upsertResumeSessionWithScores reuses old rows without creating feedback_sessions,
-- so created_at alone is not a reliable staleness signal.

ALTER TABLE resume_sessions ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Backfill existing rows: set updated_at = created_at so nothing looks artificially fresh
UPDATE resume_sessions SET updated_at = created_at WHERE updated_at IS NULL;
