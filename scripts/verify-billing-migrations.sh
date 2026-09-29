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
#   5. (dev0 integration) The same 022 + 023 apply on a schema that ALREADY
#      carries voice migrations 020 + 021: stripe_event_log (020) and
#      stripe_event_ledger (022) coexist, voice columns survive, and the
#      webhook's atomic pack-grant batch (legacy log INSERT + credit UPDATE +
#      ledger processed-mark) is all-or-nothing — a replayed event id fails
#      the legacy INSERT and nothing else in the batch lands.
#   6. The recipient-guarded processed-mark: when the recipient users row is
#      missing at commit time the mark's NOT NULL violation aborts the whole
#      batch (no credits, no legacy-log row, ledger not processed); with the
#      row present the identical batch commits.
#   7. Rollback ORDER with representative duplicate data: after 023 a data
#      rollback that re-introduces a duplicate Stripe id is refused; after
#      dropping the 023 unique indexes (and restoring the ordinary index) the
#      same restore succeeds, and every 022 object survives.
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

echo "== rollback ORDER: a duplicate-id restore is refused under 023; drop the indexes FIRST, then restore =="
# uid_B's before-image (from the simulated reconciliation above) held cus_dup,
# which uid_A still holds — exactly the tool-shaped rollback UPDATE.
RESTORE_B="UPDATE users SET plan = 'essential', subscription_status = 'active', stripe_customer_id = 'cus_dup', stripe_subscription_id = 'sub_B', current_period_start = NULL, current_period_end = NULL, trial_ends_at = NULL, cancel_at = NULL, scheduled_plan = NULL, scheduled_at = NULL, has_ever_paid = 1, plan_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = (SELECT id FROM users WHERE auth_id = 'uid_B');"
if sq "$RESTORE_B" 2>/dev/null; then
  fail "a data rollback that re-introduces a duplicate id must be refused while 023's unique index exists"
fi
[ "$(sq "SELECT stripe_customer_id IS NULL FROM users WHERE auth_id='uid_B';")" = "1" ] || fail "refused restore must leave the row untouched"
sq "DROP INDEX IF EXISTS idx_users_stripe_customer_id_unique;
DROP INDEX IF EXISTS idx_users_stripe_subscription_id_unique;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);"
sq "$RESTORE_B" || fail "the same restore must succeed once the 023 indexes are dropped"
[ "$(sq "SELECT COUNT(*) FROM users WHERE stripe_customer_id='cus_dup';")" = "2" ] || fail "before-image (duplicate id) restored"
[ "$(sq "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('billing_repair_audit','stripe_event_ledger');")" = "2" ] || fail "022 objects must survive the 023 rollback"
sq "PRAGMA table_info(users);" | grep -q current_period_start || fail "022 column must survive the 023 rollback"
[ "$(sq "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_users_stripe_customer_id';")" = "1" ] || fail "ordinary index restored"

echo "== 022 is not idempotent on the ALTER (documented) =="
if sqlite3 "$DB" < "$MIG_DIR/022_billing_periods_and_audit.sql" 2>/dev/null; then
  fail "re-running 022 should error on the duplicate ALTER (SQLite has no IF NOT EXISTS for columns)"
fi

echo "== (dev0) voice-first schema: 020 -> 021 -> 022 -> 023 =="
DB2="$(mktemp /tmp/billing-mig-voice-XXXXXX.sqlite)"
trap 'rm -f "$DB" "$DB2"' EXIT
sq2() { sqlite3 "$DB2" "$1"; }
sq2 "CREATE TABLE users (
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
sqlite3 "$DB2" < "$MIG_DIR/020_add_voice_entitlements.sql" || fail "020 did not apply"
sqlite3 "$DB2" < "$MIG_DIR/021_add_voice_end_reason.sql" || fail "021 did not apply"
sqlite3 "$DB2" < "$MIG_DIR/022_billing_periods_and_audit.sql" || fail "022 did not apply on the voice schema"
[ "$(sq2 "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('stripe_event_log','stripe_event_ledger','billing_repair_audit','voice_sessions');")" = "4" ] \
  || fail "020/022 tables must coexist (stripe_event_log + stripe_event_ledger + billing_repair_audit + voice_sessions)"
for col in voice_sessions_remaining free_session_used pack_expires_at current_period_start; do
  sq2 "PRAGMA table_info(users);" | grep -q "$col" || fail "users.$col missing on the voice-first schema"
done
sq2 "PRAGMA table_info(voice_sessions);" | grep -q end_reason || fail "voice_sessions.end_reason (021) missing"
sqlite3 "$DB2" < "$MIG_DIR/023_stripe_id_uniqueness.sql" || fail "023 did not apply on the voice schema"
[ "$(sq2 "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_users_stripe_customer_id_unique','idx_users_stripe_subscription_id_unique');")" = "2" ] \
  || fail "023 unique indexes missing on the voice schema"

echo "== (dev0) pack-grant batch is atomic with the ledger; replay cannot double-credit =="
sq2 "INSERT INTO users (auth_id, plan) VALUES ('uid_pack','free');
INSERT INTO stripe_event_ledger (event_id, event_type, livemode, status, claimed_at) VALUES ('evt_pack_1','checkout.session.completed',0,'processing',datetime('now'));"
PACK_BATCH="BEGIN;
INSERT INTO stripe_event_log (event_id, type) VALUES ('evt_pack_1','pack_grant');
INSERT INTO stripe_event_log (event_id, type) VALUES ('cs_pack_1','pack_fulfilment');
UPDATE users SET voice_sessions_remaining = voice_sessions_remaining + 5, pack_expires_at = '2026-12-05T00:00:00.000Z', has_ever_paid = 1,
  plan = CASE WHEN plan IS NULL OR plan IN ('', 'free') THEN 'pack' ELSE plan END, updated_at = datetime('now') WHERE auth_id = 'uid_pack';
UPDATE stripe_event_ledger SET status = 'processed', processed_at = datetime('now'), last_error = NULL WHERE event_id = 'evt_pack_1';
COMMIT;"
sqlite3 -bail "$DB2" "$PACK_BATCH" || fail "first pack-grant batch should commit"
[ "$(sq2 "SELECT voice_sessions_remaining || '|' || plan || '|' || has_ever_paid FROM users WHERE auth_id='uid_pack';")" = "5|pack|1" ] \
  || fail "pack grant should credit 5 sessions, set plan=pack and has_ever_paid"
[ "$(sq2 "SELECT status FROM stripe_event_ledger WHERE event_id='evt_pack_1';")" = "processed" ] || fail "ledger mark should commit with the grant"
# Replay under a fresh claim: the legacy-log INSERT is refused, so -bail
# aborts before COMMIT and the open transaction is discarded — nothing lands.
sq2 "UPDATE stripe_event_ledger SET status='processing' WHERE event_id='evt_pack_1';"
if sqlite3 -bail "$DB2" "$PACK_BATCH" 2>/dev/null; then
  fail "replayed pack-grant batch must be refused by the stripe_event_log primary key"
fi
[ "$(sq2 "SELECT voice_sessions_remaining FROM users WHERE auth_id='uid_pack';")" = "5" ] || fail "replay must not double-credit"
[ "$(sq2 "SELECT status FROM stripe_event_ledger WHERE event_id='evt_pack_1';")" = "processing" ] || fail "replay must not mark the ledger processed when the grant was refused"

echo "== (dev0) a DISTINCT event for the SAME Checkout Session is refused by the session marker; nothing lands =="
sq2 "INSERT INTO stripe_event_ledger (event_id, event_type, livemode, status, claimed_at) VALUES ('evt_pack_1b','checkout.session.async_payment_succeeded',0,'processing',datetime('now'));"
SECOND_EVENT_BATCH="BEGIN;
INSERT INTO stripe_event_log (event_id, type) VALUES ('evt_pack_1b','pack_grant');
INSERT INTO stripe_event_log (event_id, type) VALUES ('cs_pack_1','pack_fulfilment');
UPDATE users SET voice_sessions_remaining = voice_sessions_remaining + 5, updated_at = datetime('now') WHERE auth_id = 'uid_pack';
UPDATE stripe_event_ledger SET status = CASE WHEN (SELECT COUNT(*) FROM users WHERE auth_id IN ('uid_pack')) = 1 THEN 'processed' ELSE NULL END, processed_at = datetime('now'), last_error = NULL WHERE event_id = 'evt_pack_1b';
COMMIT;"
if sqlite3 -bail "$DB2" "$SECOND_EVENT_BATCH" 2>/dev/null; then
  fail "a second distinct event for an already-fulfilled session must be refused by the pack_fulfilment marker"
fi
[ "$(sq2 "SELECT voice_sessions_remaining FROM users WHERE auth_id='uid_pack';")" = "5" ] || fail "second event must not double-credit the session"
[ "$(sq2 "SELECT COUNT(*) FROM stripe_event_log WHERE event_id='evt_pack_1b';")" = "0" ] || fail "the refused event's own record must roll back with the batch"
[ "$(sq2 "SELECT status FROM stripe_event_ledger WHERE event_id='evt_pack_1b';")" = "processing" ] || fail "refused second event stays unprocessed (the webhook marks it failed, then its retry records a no-op)"
echo "== (dev0) recipient-guarded processed-mark: missing recipient aborts the WHOLE batch =="
sq2 "INSERT INTO stripe_event_ledger (event_id, event_type, livemode, status, claimed_at) VALUES ('evt_pack_2','checkout.session.completed',0,'processing',datetime('now'));"
GUARDED_BATCH="BEGIN;
INSERT INTO stripe_event_log (event_id, type) VALUES ('evt_pack_2','pack_grant');
UPDATE users SET voice_sessions_remaining = voice_sessions_remaining + 5, pack_expires_at = '2026-12-05T00:00:00.000Z', has_ever_paid = 1,
  plan = CASE WHEN plan IS NULL OR plan IN ('', 'free') THEN 'pack' ELSE plan END, updated_at = datetime('now') WHERE auth_id = 'uid_ghost';
UPDATE stripe_event_ledger SET status = CASE WHEN (SELECT COUNT(*) FROM users WHERE auth_id IN ('uid_ghost')) = 1 THEN 'processed' ELSE NULL END,
  processed_at = datetime('now'), last_error = NULL WHERE event_id = 'evt_pack_2';
COMMIT;"
if sqlite3 -bail "$DB2" "$GUARDED_BATCH" 2>/dev/null; then
  fail "the guarded batch must abort when the recipient row is missing"
fi
[ "$(sq2 "SELECT COUNT(*) FROM stripe_event_log WHERE event_id='evt_pack_2';")" = "0" ] || fail "legacy log row must roll back with the aborted batch (event not consumed)"
[ "$(sq2 "SELECT status FROM stripe_event_ledger WHERE event_id='evt_pack_2';")" = "processing" ] || fail "ledger must not be marked processed without a recipient"
sq2 "INSERT INTO users (auth_id, plan) VALUES ('uid_ghost','free');"
sqlite3 -bail "$DB2" "$GUARDED_BATCH" || fail "the identical guarded batch must commit once the recipient exists"
[ "$(sq2 "SELECT voice_sessions_remaining || '|' || plan FROM users WHERE auth_id='uid_ghost';")" = "5|pack" ] || fail "recipient credited on the retry"
[ "$(sq2 "SELECT status FROM stripe_event_ledger WHERE event_id='evt_pack_2';")" = "processed" ] || fail "ledger processed together with the grant"

# A subscription plan write never touches the voice credit columns.
sq2 "UPDATE users SET plan='monthly', subscription_status='active', stripe_customer_id='cus_pk', stripe_subscription_id='sub_pk', current_period_start='2026-09-01T00:00:00.000Z', current_period_end='2026-10-01T00:00:00.000Z', plan_updated_at=datetime('now') WHERE auth_id='uid_pack';"
[ "$(sq2 "SELECT voice_sessions_remaining || '|' || plan FROM users WHERE auth_id='uid_pack';")" = "5|monthly" ] || fail "subscription write must preserve pack credits"

echo "verify-billing-migrations.sh: ALL CHECKS PASSED (including the dev0 voice-first schema)"
