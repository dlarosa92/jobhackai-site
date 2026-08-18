-- Migration: Subscription period start + billing repair audit + webhook event ledger
-- Purpose: Stripe hotfix (billing integrity). Adds:
--   1. users.current_period_start (current_period_end already exists from 007)
--   2. billing_repair_audit — before/after images for the one-time billing
--      reconciliation (local operator script: app/scripts/billing-reconcile.mjs)
--   3. stripe_event_ledger — durable, authoritative webhook idempotency record
-- Date: 2026-08-16
--
-- *** HARD PRE-DEPLOY DEPENDENCY ***
-- The hotfix webhook FAILS CLOSED (503, zero processing) when
-- stripe_event_ledger is missing. Apply this migration to an environment's
-- D1 BEFORE deploying the hotfix code there. Old code ignores all three new
-- objects, so applying early is always safe. Never roll this migration back
-- while hotfix code is deployed.
--
-- SQLite doesn't support IF NOT EXISTS for ADD COLUMN; running this file
-- twice will error on the ALTER (safe — it just means it already ran).
--
-- Apply:
--   npx wrangler d1 execute jobhackai-dev-db  --remote --file=app/db/migrations/022_billing_periods_and_audit.sql
--   npx wrangler d1 execute jobhackai-qa-db   --remote --file=app/db/migrations/022_billing_periods_and_audit.sql
--   npx wrangler d1 execute jobhackai-prod-db --remote --file=app/db/migrations/022_billing_periods_and_audit.sql
--
-- Verify:
--   npx wrangler d1 execute <db> --remote --command="PRAGMA table_info(users);"
--   npx wrangler d1 execute <db> --remote --command="SELECT name FROM sqlite_master WHERE name IN ('billing_repair_audit','stripe_event_ledger');"

-- ISO-8601 datetime string, same convention as current_period_end (007)
ALTER TABLE users ADD COLUMN current_period_start TEXT;

-- Before/after images for every row the billing reconciliation touches.
-- Full Stripe ids live here (in-database audit), never in HTTP responses
-- or logs. Modeled on role_template_audit (migration 009).
CREATE TABLE IF NOT EXISTS billing_repair_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,                    -- one id per reconciliation invocation
  mode TEXT NOT NULL,                      -- 'apply' | 'rollback'
  user_row_id INTEGER NOT NULL,            -- users.id (never deleted by reconciliation)
  auth_id TEXT NOT NULL,                   -- users.auth_id at time of change
  stripe_customer_id TEXT,                 -- pre-change value (full id)
  stripe_subscription_id TEXT,             -- pre-change value (full id)
  old_values_json TEXT NOT NULL,           -- complete before-image of billing fields
  new_values_json TEXT NOT NULL,           -- values written by this run
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_repair_audit_run_id ON billing_repair_audit(run_id);

-- Durable webhook event ledger — the AUTHORITATIVE idempotency record for
-- /api/stripe-webhook (KV is a performance aid only). Semantics:
--   * one row per correct-mode, validly signed event (wrong-mode events are
--     never written anywhere — they are acknowledged with zero writes)
--   * status='processed' is set in the SAME atomic db.batch() as the event's
--     critical billing writes, so a crash can never apply billing changes
--     without marking the event (or mark it without applying them)
--   * status='failed' events are retryable: Stripe's retry re-claims them
--   * a 'processing' row older than the claim timeout is a crashed run and
--     may be re-claimed (claimed_at tracks the most recent claim; received_at
--     keeps the first receipt)
-- Distinct name from dev0's stripe_event_log (voice migration 020) to avoid
-- a schema collision at merge time; reconciling the two is a dev0-merge step.
CREATE TABLE IF NOT EXISTS stripe_event_ledger (
  event_id TEXT PRIMARY KEY,               -- Stripe event id (evt_...)
  event_type TEXT NOT NULL,                -- e.g. customer.subscription.updated
  livemode INTEGER NOT NULL,               -- 1 live / 0 test; always matches this environment's expected mode
  status TEXT NOT NULL,                    -- 'processing' | 'processed' | 'failed'
  attempt_count INTEGER NOT NULL DEFAULT 1,
  received_at TEXT DEFAULT (datetime('now')),  -- first receipt
  claimed_at TEXT,                         -- most recent claim (stale-claim recovery)
  processed_at TEXT,                       -- set only when all critical writes committed
  last_error TEXT                          -- redacted reason label; never payloads/identifiers
);

CREATE INDEX IF NOT EXISTS idx_stripe_event_ledger_status ON stripe_event_ledger(status);

-- Rollback (only if forced; data rollback goes through the reconciliation
-- script's --rollback mode, which restores old_values_json):
--   NEVER while hotfix code is deployed — the webhook 503s without the
--   ledger table. Roll the code back first, then:
--   ALTER TABLE users DROP COLUMN current_period_start;
--   DROP TABLE billing_repair_audit;
--   DROP TABLE stripe_event_ledger;
