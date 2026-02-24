-- Migration 018: Add email column to deleted_auth_ids.
-- Allows isTrialEligible to block free trial re-use by email even when the
-- returning user registers under a new Firebase UID after account deletion.
ALTER TABLE deleted_auth_ids ADD COLUMN email TEXT;

CREATE INDEX IF NOT EXISTS idx_deleted_auth_ids_email ON deleted_auth_ids(email);
