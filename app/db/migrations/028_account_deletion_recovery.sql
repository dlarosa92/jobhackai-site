-- Deploy before wiring the durable deletion handler/recovery worker.
-- Deliberately no users FK: recovery must survive removal of the account row.
CREATE TABLE IF NOT EXISTS account_deletion_jobs (
  id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  email TEXT,
  phase TEXT NOT NULL DEFAULT 'prepared'
    CHECK (phase IN ('prepared', 'billing_verified', 'identity_removed', 'complete')),
  kv_keys_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_pending
  ON account_deletion_jobs(phase, updated_at);
