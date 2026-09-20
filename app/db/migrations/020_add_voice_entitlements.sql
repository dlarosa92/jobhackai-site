-- Migration: Voice mock interview entitlements (repositioning)
-- Purpose: per-user voice session entitlement state plus voice session
--          lifecycle/cost tracking. Entitlement fields are written ONLY by
--          Stripe webhooks and server code; clients have no write path.
-- Date: 2026-06-13
--
-- IMPORTANT: Existing databases must run this migration.
-- SQLite doesn't support IF NOT EXISTS for ADD COLUMN; running twice will error.
--
-- Run per environment:
--   npx wrangler d1 execute jobhackai-dev-db  --remote --file=app/db/migrations/020_add_voice_entitlements.sql
--   npx wrangler d1 execute jobhackai-qa-db   --remote --file=app/db/migrations/020_add_voice_entitlements.sql
--   npx wrangler d1 execute jobhackai-prod-db --remote --file=app/db/migrations/020_add_voice_entitlements.sql

-- Voice entitlement state (plan column already exists; new values: weekly | monthly | pack)
ALTER TABLE users ADD COLUMN voice_sessions_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN free_session_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pack_expires_at TEXT;
ALTER TABLE users ADD COLUMN voice_followup_email_sent_at TEXT;

-- Hard idempotency for credit-granting webhook events (KV dedup is best-effort;
-- this guarantees a replayed checkout.session.completed cannot double-grant).
CREATE TABLE IF NOT EXISTS stripe_event_log (
  event_id TEXT PRIMARY KEY,
  type TEXT,
  processed_at TEXT DEFAULT (datetime('now'))
);

-- Voice session lifecycle, transcript, scorecard, and per-session model cost
CREATE TABLE IF NOT EXISTS voice_sessions (
  id TEXT PRIMARY KEY,                          -- UUID minted server-side
  user_id INTEGER NOT NULL,
  role TEXT,
  seniority TEXT,
  jd_excerpt TEXT,                              -- first ~2k chars of pasted JD
  status TEXT NOT NULL DEFAULT 'created',       -- created | active | completed | abandoned
  entitlement_mode TEXT,                        -- free | pack | subscription
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  duration_seconds INTEGER,
  transcript_json TEXT,
  scorecard_json TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,                                -- computed per-session model cost
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_status ON voice_sessions(status);
