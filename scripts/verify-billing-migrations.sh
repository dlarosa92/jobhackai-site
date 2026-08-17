#!/usr/bin/env bash
# Verifies migrations 022 + 023 against a representative schema using the
# sqlite3 CLI (preinstalled on GitHub ubuntu runners and most dev machines).
#
# Proves:
#   1. 022 applies cleanly: current_period_start column + billing_repair_audit
#      + stripe_event_ledger exist afterwards.
#   2. The 023 gate query correctly detects duplicates, and 023 FAILS while
#      duplicates exist (CREATE UNIQUE INDEX refuses).
#   3. After cleanup, 023 applies; duplicate Stripe ids are then refused,
#      NULL duplicates (free users) remain allowed, and an old-code-shaped
#      UPDATE (no current_period_start) still works post-023.
#   4. The webhook ledger claim UPSERT semantics work on this schema:
#      first claim inserts, a duplicate claim is refused, a failed claim is
#      re-claimable.
set -euo pipefail

cd "$(dirname "$0")/.."
MIG_DIR="app/db/migrations"
DB="$(mktemp /tmp/billing-mig-XXXXXX.sqlite)"
trap 'rm -f "$DB"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }
sq() { sqlite3 "$DB" "$1"; }

echo "== representative base schema (users as the deployed code uses it) =="
sq "CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_id TEXT UNIQUE NOT NULL,
  email TEXT,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT,
  trial_ends_at TEXT,
  current_period_end TEXT,
  cancel_at TEXT,
  scheduled_plan TEXT,
  scheduled_at TEXT,
  has_ever_paid INTEGER DEFAULT 0,
  plan_updated_at TEXT,
  last_login_at TEXT,
  deletion_warning_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);"

echo "== apply migration 022 =="
sqlite3 "$DB" < "$MIG_DIR/022_billing_periods_and_audit.sql" || fail "022 did not apply"
sq "PRAGMA table_info(users);" | grep -q current_period_start || fail "current_period_start column missing after 022"
[ "$(sq "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('billing_repair_audit','stripe_event_ledger');")" = "2" ] \
  || fail "022 tables missing"

echo "== seed duplicates, prove the 023 gate detects them =="
sq "INSERT INTO users (auth_id, plan, stripe_customer_id, stripe_subscription_id) VALUES
  ('uid_A','essential','cus_dup','sub_A'),
  ('uid_B','essential','cus_dup','sub_B'),
  ('uid_C','pro','cus_C','sub_dup'),
  ('uid_D','pro','cus_D','sub_dup'),
  ('uid_free1','free',NULL,NULL),
  ('uid_free2','free',NULL,NULL);"
DUPS=$(sq "SELECT COUNT(*) FROM (SELECT stripe_customer_id FROM users WHERE stripe_customer_id IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1);")
[ "$DUPS" = "1" ] || fail "gate query should find 1 duplicate customer group, found $DUPS"

echo "== 023 must FAIL while duplicates exist =="
if sqlite3 "$DB" < "$MIG_DIR/023_stripe_id_uniqueness.sql" 2>/dev/null; then
  fail "023 applied despite duplicates — unique index did not protect"
fi

echo "== clean duplicates (simulating the reconciliation), re-apply 023 =="
sq "UPDATE users SET stripe_customer_id=NULL, stripe_subscription_id=NULL, plan='free' WHERE auth_id IN ('uid_B','uid_D');"
sqlite3 "$DB" < "$MIG_DIR/023_stripe_id_uniqueness.sql" || fail "023 did not apply after cleanup"

echo "== duplicates are refused post-023; NULL duplicates stay allowed =="
if sq "UPDATE users SET stripe_customer_id='cus_dup' WHERE auth_id='uid_B';" 2>/dev/null; then
  fail "duplicate customer id accepted after 023"
fi
if sq "INSERT INTO users (auth_id, stripe_subscription_id) VALUES ('uid_E','sub_dup');" 2>/dev/null; then
  fail "duplicate subscription id accepted after 023"
fi
sq "INSERT INTO users (auth_id) VALUES ('uid_free3');" || fail "NULL stripe ids must remain insertable"

echo "== old-code-shaped UPDATE (no current_period_start) still works post-023 =="
sq "UPDATE users SET plan='pro', subscription_status='active', current_period_end='2026-09-01T00:00:00.000Z', plan_updated_at=datetime('now'), updated_at=datetime('now') WHERE auth_id='uid_A';" \
  || fail "old-code UPDATE failed post-023"

echo "== ledger claim semantics on this schema =="
CLAIM="INSERT INTO stripe_event_ledger (event_id, event_type, livemode, status, claimed_at)
VALUES ('evt_1','t',1,'processing',datetime('now'))
ON CONFLICT(event_id) DO UPDATE SET status='processing', attempt_count=attempt_count+1, claimed_at=datetime('now'), last_error=NULL
WHERE stripe_event_ledger.status='failed'
   OR (stripe_event_ledger.status='processing' AND stripe_event_ledger.claimed_at <= datetime('now','-15 minutes'))
RETURNING status;"
[ "$(sq "$CLAIM")" = "processing" ] || fail "first claim should insert"
[ -z "$(sq "$CLAIM")" ] || fail "second claim of a fresh processing row must be refused"
sq "UPDATE stripe_event_ledger SET status='failed', last_error='x' WHERE event_id='evt_1';"
[ "$(sq "$CLAIM")" = "processing" ] || fail "failed events must be re-claimable"
[ "$(sq "SELECT attempt_count FROM stripe_event_ledger WHERE event_id='evt_1';")" = "2" ] || fail "re-claim should bump attempt_count"
sq "UPDATE stripe_event_ledger SET status='processed', processed_at=datetime('now') WHERE event_id='evt_1';"
[ -z "$(sq "$CLAIM")" ] || fail "processed events must never be re-claimed"

echo "== 022 is not idempotent on the ALTER (documented) =="
if sqlite3 "$DB" < "$MIG_DIR/022_billing_periods_and_audit.sql" 2>/dev/null; then
  fail "re-running 022 should error on the duplicate ALTER (SQLite has no IF NOT EXISTS for columns)"
fi

echo "verify-billing-migrations.sh: ALL CHECKS PASSED"
