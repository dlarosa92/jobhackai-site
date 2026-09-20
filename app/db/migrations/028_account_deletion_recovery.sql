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
  -- Exclusive execution, with no automatic crash/timeout takeover. A stuck
  -- token requires explicit reconciliation before another runner can proceed.
  execution_token TEXT,
  execution_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_pending
  ON account_deletion_jobs(phase, updated_at);

-- Completion notification is independent of erased content. A sender must
-- enforce bounded retry/retention and provider idempotency before deployment.
CREATE TABLE IF NOT EXISTS account_deletion_notifications (
  job_id TEXT PRIMARY KEY REFERENCES account_deletion_jobs(id),
  email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','needs_review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

-- A deletion intent stops NEW operations immediately. Existing operations must
-- finish or be explicitly reconciled before billing/identity deletion begins.
-- No lease timeout silently assumes an external billing call did not happen.
CREATE TABLE IF NOT EXISTS account_deletion_admissions (
  id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL UNIQUE,
  email TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('user_request','inactivity')),
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','complete')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only an accepted warning for the current address can start the inactivity
-- notice period. Legacy timestamps alone are not delivery evidence.
CREATE TABLE IF NOT EXISTS account_inactivity_warnings (
  id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','needs_review','canceled')),
  provider_id TEXT,
  operation_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS account_deletion_withdrawals (
  id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('inactivity_no_longer_eligible','inactivity_billing_unconfirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS account_operation_claims (
  id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('billing','account','maintenance')),
  -- A crashed webhook can be matched to its durable event ledger without
  -- retaining event payloads, email, credentials or interview content.
  webhook_event_id TEXT,
  -- Provider reconciliation needs the event identity, never its campaign or
  -- browser payload. An unfinished delivery may not acquire another claim.
  analytics_event_key TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','finished','uncertain')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_account_operations_pending
  ON account_operation_claims(auth_id,state);
CREATE INDEX IF NOT EXISTS idx_account_operations_analytics
  ON account_operation_claims(analytics_event_key,state);

-- Bounded retention passes advance only after their selected accounts finish.
CREATE TABLE IF NOT EXISTS account_maintenance_cursors (
  name TEXT PRIMARY KEY,
  last_user_id INTEGER NOT NULL DEFAULT 0 CHECK (last_user_id>=0),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
