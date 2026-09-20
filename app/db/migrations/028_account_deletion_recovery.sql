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

-- A deletion intent stops NEW operations immediately. Existing operations must
-- finish or be explicitly reconciled before billing/identity deletion begins.
-- No lease timeout silently assumes an external billing call did not happen.
CREATE TABLE IF NOT EXISTS account_deletion_admissions (
  id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL UNIQUE,
  email TEXT,
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','complete')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS account_operation_claims (
  id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('billing','account')),
  -- A crashed webhook can be matched to its durable event ledger without
  -- retaining event payloads, email, credentials or interview content.
  webhook_event_id TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','finished','uncertain')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_account_operations_pending
  ON account_operation_claims(auth_id,state);
