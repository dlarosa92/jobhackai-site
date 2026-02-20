-- Add activity tracking columns for GDPR compliance
-- last_login_at: updated on each successful login/upsert
-- last_activity_at: updated on each feature usage event
-- deletion_warning_sent_at: tracks when 23-month inactivity warning was sent

ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN last_activity_at TEXT;
ALTER TABLE users ADD COLUMN deletion_warning_sent_at TEXT;
