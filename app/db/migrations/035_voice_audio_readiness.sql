-- Audio setup owns a short provider deadline but no interview entitlement.
-- The server may replace that deadline once, after explicit readiness.
-- No transcript, device name, role context or credentials in this ledger.
ALTER TABLE voice_interview_controls ADD COLUMN audio_check_deadline_at TEXT;
ALTER TABLE voice_interview_controls ADD COLUMN audio_ready_at TEXT;
ALTER TABLE voice_interview_controls ADD COLUMN audio_check_mode TEXT CHECK (audio_check_mode IN ('free','pack','subscription'));
CREATE INDEX IF NOT EXISTS idx_voice_audio_check_rate
  ON voice_interview_controls(auth_id, created_at)
  WHERE audio_check_deadline_at IS NOT NULL;
