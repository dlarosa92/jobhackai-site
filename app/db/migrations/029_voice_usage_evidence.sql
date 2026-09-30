-- 028 is reserved for the separate account-deletion recovery draft.
-- Old cost_usd values remain historical estimates; do not reinterpret them.
-- Evidence is erased with its voice session through existing retention/deletion.
ALTER TABLE voice_sessions ADD COLUMN usage_details_json TEXT;
