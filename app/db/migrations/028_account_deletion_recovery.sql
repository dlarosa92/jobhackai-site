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

-- Completion notification is independent of erased content. Successful sends
-- clear the address immediately; remaining addresses expire after seven days.
CREATE TABLE IF NOT EXISTS account_deletion_notifications (
  job_id TEXT PRIMARY KEY NOT NULL REFERENCES account_deletion_jobs(id),
  email TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','needs_review','expired')),
  template_version TEXT NOT NULL DEFAULT 'account-deletion-v1',
  provider_id TEXT,
  execution_token TEXT,
  execution_started_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  next_attempt_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+7 days')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  CHECK ((state IN ('sent','expired') AND email IS NULL)
    OR (state IN ('pending','sending','needs_review') AND email IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_deletion_notifications_queue
  ON account_deletion_notifications(state,next_attempt_at);

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
  purpose TEXT NOT NULL DEFAULT 'api' CHECK (purpose IN ('api','webhook','analytics','followup','retention','inactivity','maintenance')),
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

-- Operational receipts contain no customer content or provider payloads.
-- Suppressed delivery stays suppressed even if an outbox/marker is reset.
CREATE TABLE IF NOT EXISTS account_operation_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  auth_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  purpose TEXT NOT NULL,
  state_before TEXT NOT NULL CHECK (state_before IN ('active','uncertain')),
  updated_before TEXT NOT NULL,
  analytics_event_key TEXT,
  disposition TEXT NOT NULL CHECK (disposition IN ('verified','retry_storage','suppress_delivery')),
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256)=64),
  operator_ref TEXT NOT NULL,
  invocation_ref TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (disposition<>'retry_storage' OR purpose='retention'),
  CHECK (disposition<>'suppress_delivery' OR purpose IN ('analytics','followup','inactivity'))
);
CREATE INDEX IF NOT EXISTS idx_operation_reconciliation_owner
  ON account_operation_reconciliations(auth_id,purpose,disposition);
CREATE INDEX IF NOT EXISTS idx_operation_reconciliation_event
  ON account_operation_reconciliations(analytics_event_key,disposition);
CREATE TRIGGER IF NOT EXISTS reconcile_stopped_account_operation
AFTER INSERT ON account_operation_reconciliations BEGIN
  UPDATE account_operation_claims SET state='finished',updated_at=datetime('now')
  WHERE id=NEW.operation_id AND auth_id=NEW.auth_id AND kind=NEW.kind AND purpose=NEW.purpose
    AND state=NEW.state_before AND updated_at=NEW.updated_before
    AND analytics_event_key IS NEW.analytics_event_key;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'operation_reconciliation_conflict') END;
  UPDATE analytics_delivery SET
    state=CASE WHEN state IN ('accepted_unverified','rejected','expired','ineligible') THEN state ELSE 'uncertain' END,
    lease_until=NULL,last_reason='operator_suppressed',updated_at=unixepoch()*1000
    WHERE event_key=NEW.analytics_event_key AND NEW.purpose='analytics' AND NEW.disposition='suppress_delivery';
  UPDATE users SET voice_followup_email_sent_at=COALESCE(voice_followup_email_sent_at,datetime('now'))
    WHERE auth_id=NEW.auth_id AND NEW.purpose='followup' AND NEW.disposition='suppress_delivery';
  UPDATE account_inactivity_warnings SET state='needs_review',last_error_code='operator_suppressed'
    WHERE auth_id=NEW.auth_id AND operation_id=NEW.operation_id
      AND NEW.purpose='inactivity' AND NEW.disposition='suppress_delivery';
END;

-- Operator-only verified voice closure. Retain the receipt independently of
-- erased account/history rows; its session ID also fences reuse after erasure.
CREATE TABLE IF NOT EXISTS voice_closure_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('voice_call','voice_legacy')),
  target_id TEXT NOT NULL,
  auth_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  state_before TEXT,
  execution_before TEXT,
  provider_call_before TEXT,
  provider_key_sha256 TEXT,
  resolved_provider_call_id TEXT,
  resolution TEXT NOT NULL CHECK (resolution IN ('closed','not_created','legacy_drained')),
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256)=64),
  operator_ref TEXT NOT NULL,
  invocation_ref TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(target_kind,target_id),
  CHECK ((target_kind='voice_call' AND resolution IN ('closed','not_created')
      AND state_before IN ('creating','active','closing','uncertain') AND provider_key_sha256 IS NOT NULL AND length(provider_key_sha256)=64
      AND ((resolution='closed' AND resolved_provider_call_id IS NOT NULL)
        OR (resolution='not_created' AND provider_call_before IS NULL AND resolved_provider_call_id IS NULL
          AND execution_before IS NOT NULL AND state_before IN ('creating','uncertain'))))
    OR (target_kind='voice_legacy' AND resolution='legacy_drained' AND target_id=session_id))
);
CREATE INDEX IF NOT EXISTS idx_voice_closure_session ON voice_closure_reconciliations(session_id);

-- Operator-only recovery of a verified stopped deletion execution. The single
-- INSERT and its trigger form one atomic operation, including the audit receipt.
-- No job FK: a subsequently withdrawn inactivity job may be removed.
CREATE TABLE IF NOT EXISTS deletion_execution_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  execution_token TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('prepared','billing_verified','identity_removed')),
  job_updated_at TEXT NOT NULL,
  admission_origin TEXT NOT NULL CHECK (admission_origin IN ('user_request','inactivity')),
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256)=64),
  operator_ref TEXT NOT NULL,
  invocation_ref TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS reconcile_stopped_deletion_execution
AFTER INSERT ON deletion_execution_reconciliations BEGIN
  UPDATE account_deletion_jobs SET execution_token=NULL,execution_started_at=NULL,
    last_error_code='operator_reconciled',updated_at=datetime('now')
  WHERE id=NEW.job_id AND execution_token=NEW.execution_token
    AND phase=NEW.phase AND updated_at=NEW.job_updated_at
    AND EXISTS (SELECT 1 FROM account_deletion_admissions a
      WHERE a.id=account_deletion_jobs.id AND a.auth_id=account_deletion_jobs.auth_id
        AND a.origin=NEW.admission_origin AND a.state='requested')
    AND NOT EXISTS (SELECT 1 FROM account_operation_claims c
      WHERE c.auth_id=account_deletion_jobs.auth_id AND c.state<>'finished');
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'deletion_reconciliation_conflict') END;
END;

-- Bounded retention passes advance only after their selected accounts finish.
CREATE TABLE IF NOT EXISTS account_maintenance_cursors (
  name TEXT PRIMARY KEY,
  last_user_id INTEGER NOT NULL DEFAULT 0 CHECK (last_user_id>=0),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- Provider call control outlives browser connections and erased history rows.
-- No keys, SDP offers/answers, audio or transcripts belong in this ledger.
-- A close request can arrive before provider creation or credit reservation.
-- Keep it independently so a late start cannot reopen the interview.
CREATE TABLE IF NOT EXISTS voice_interview_controls (
  session_id TEXT PRIMARY KEY NOT NULL,
  auth_id TEXT NOT NULL,
  current_attempt_id TEXT,
  deadline_at TEXT NOT NULL,
  reserved_at TEXT,
  legacy_unverified INTEGER NOT NULL DEFAULT 0 CHECK (legacy_unverified IN (0,1)),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_interview_control_owner
  ON voice_interview_controls(auth_id);

CREATE TABLE IF NOT EXISTS voice_provider_calls (
  id TEXT PRIMARY KEY NOT NULL,
  auth_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('creating','active','closing','closed','uncertain')),
  provider_call_id TEXT UNIQUE,
  provider_key_sha256 TEXT NOT NULL CHECK (length(provider_key_sha256)=64),
  execution_token TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  CHECK (state NOT IN ('active','closing') OR provider_call_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_provider_call_in_flight
  ON voice_provider_calls(session_id) WHERE state<>'closed';
CREATE INDEX IF NOT EXISTS idx_voice_provider_call_owner
  ON voice_provider_calls(auth_id,state);
CREATE TRIGGER IF NOT EXISTS advance_managed_voice_attempt
AFTER INSERT ON voice_provider_calls BEGIN
  UPDATE voice_interview_controls SET current_attempt_id=NEW.id,updated_at=datetime('now')
    WHERE session_id=NEW.session_id AND auth_id=NEW.auth_id;
END;

CREATE TRIGGER IF NOT EXISTS reconcile_verified_voice_call
AFTER INSERT ON voice_closure_reconciliations WHEN NEW.target_kind='voice_call' BEGIN
  UPDATE voice_provider_calls SET state='closed',execution_token=NULL,
    provider_call_id=COALESCE(provider_call_id,NEW.resolved_provider_call_id),
    closed_at=datetime('now'),updated_at=datetime('now'),last_error_code='operator_verified_closed'
    WHERE id=NEW.target_id AND auth_id=NEW.auth_id AND session_id=NEW.session_id
      AND state=NEW.state_before AND execution_token IS NEW.execution_before
      AND provider_call_id IS NEW.provider_call_before AND provider_key_sha256=NEW.provider_key_sha256;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'voice_reconciliation_conflict') END;
  UPDATE voice_interview_controls SET closed_at=COALESCE(closed_at,datetime('now')),updated_at=datetime('now')
    WHERE session_id=NEW.session_id AND auth_id=NEW.auth_id AND current_attempt_id=NEW.target_id;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'voice_reconciliation_control_conflict') END;
END;
CREATE TRIGGER IF NOT EXISTS reconcile_verified_legacy_voice
AFTER INSERT ON voice_closure_reconciliations WHEN NEW.target_kind='voice_legacy' BEGIN
  UPDATE voice_interview_controls SET legacy_unverified=0,updated_at=datetime('now')
    WHERE session_id=NEW.session_id AND auth_id=NEW.auth_id AND closed_at IS NOT NULL AND legacy_unverified=1
      AND NOT EXISTS(SELECT 1 FROM voice_provider_calls WHERE session_id=NEW.session_id AND state<>'closed');
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'voice_reconciliation_legacy_conflict') END;
END;
