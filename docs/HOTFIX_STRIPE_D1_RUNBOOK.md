# Stripe / D1 Billing Integrity Hotfix — Release Runbook

Fixes the incident in which Stripe **test-mode** webhook events wrote into the
**production** D1 database (12 rows falsely paid, duplicate Stripe IDs,
`current_period_end` NULL for all users). What ships:

- **Mode gate**: production processes only live events, qa/dev only test
  events; wrong-mode events are acknowledged with **zero D1/KV writes**.
  Unknown/missing `ENVIRONMENT` is a 503 config error (fully fail-closed).
- **Durable event ledger** (`stripe_event_ledger`, migration 022): the
  authoritative webhook idempotency record. Critical billing writes and the
  ledger's processed-mark commit in **one atomic `db.batch()`** — no crash
  gap. Failures are recorded (`status='failed'`) and returned as 5xx so
  Stripe retries; KV is a performance aid only.
- **Ownership**: identity from verified metadata only (subscription →
  session → customer), conflict detection, cross-user guard before every
  write, uid-proven-only customer selection (email matching alone never
  selects, un-stamped customers are never adopted or stamped).
- **Period dates**: explicit single-item rule (root fields, else exactly one
  plan-mapped item); ambiguity is a recorded failure, never a guess; both
  `current_period_start` and `current_period_end` persisted; cleared on
  subscription deletion.
- **Reconciliation**: local operator CLI `app/scripts/billing-reconcile.mjs`
  (nothing deployed), dry-run by default, allowlisted, audited, atomic,
  reversible. No DELETE statements exist in the tool.
- **Hardening**: legacy `/api/stripe`, `/api/subscription`, `/api/auth`
  retired (provisional — see step 0) + middleware `RETIRED_PATHS` second
  layer; debug endpoints fail closed; resume worker `workers_dev=false`.

**Development gate:** implementation is reviewed locally first — no commit or
push happens until the owner has reviewed the diff and test results and
explicitly authorized them.

---

## Hard ordering rules

1. **Migration 022 BEFORE code deploy, in every environment.** The new
   webhook fails closed (503) until `stripe_event_ledger` exists. Old code
   ignores the new objects, so applying 022 early is always safe.
2. **Migration 023 only after the environment's data is duplicate-free**
   (`--verify` clean), and only in production after it has been applied and
   regression-tested **in QA first**.
3. **Never roll back 022 while hotfix code is deployed** (webhook 503s
   without the ledger). Roll code back first.

---

## Step 0 — Pre-merge verifications (read-only, operator)

- [ ] Production Pages env: `STRIPE_SECRET_KEY` is `sk_live_*`, live
      `whsec_*`, `ENVIRONMENT=PROD` (dashboard eyes-on; `/api/health-env`
      with an authed token for existence checks). Fixing a wrong key/var is
      the root-cause remediation and precedes everything else.
- [ ] QA Pages env: `sk_test_*` key, test `whsec_*`, `ENVIRONMENT=qa`.
- [ ] Cloudflare Pages Function metrics/logs over a trailing window show no
      legitimate traffic to `/api/stripe`, `/api/subscription`, `/api/auth`.
- [ ] Stripe dashboard (live AND test): no webhook endpoint targets
      `/api/stripe` — only `/api/stripe-webhook`.
- [ ] **Gate:** if real traffic exists, convert the file deletions to
      secure-in-place (keep files; middleware `RETIRED_PATHS` already blocks
      the routes) before merging. The deletion commit stays provisional
      until this step passes.

## Step 1 — QA

1. Open PR: hotfix branch → `develop`. Review + CI green (`Billing Tests`
   workflow). Merge.
2. Back up QA D1:
   `npx wrangler d1 export jobhackai-qa-db --remote --output=backups/qa-pre-hotfix.sql`
   and record Time Travel bookmark: `npx wrangler d1 time-travel info jobhackai-qa-db`.
3. **Apply 022 to QA (before deploy — hard dependency):**
   `npx wrangler d1 execute jobhackai-qa-db --remote --file=app/db/migrations/022_billing_periods_and_audit.sql`
4. Deploy `develop` → QA (Pages auto-deploy, or `npm run deploy:qa` from `app/`).
5. Run `npm run test:billing` + `npm run test:billing:migrations` + the
   manual QA script (plan §6): free plan, test checkout (4242), row
   ownership, uniqueness query, period dates, update, cancellation, replay,
   wrong-mode probe (expect 200 `[ignored-wrong-mode]`, **zero** D1/KV
   writes, no ledger row), reload, paid gate, `/api/stripe` 404, trial
   conversion (converts once, replay never re-resets).
6. **Reconciliation rehearsal on QA:**
   - `node app/scripts/billing-reconcile.mjs --preflight --env=qa --report=qa-preflight.json`
   - seed/confirm QA duplicates, then `--apply --allowlist=<file> --run-id=qa_rehearsal_1 --env=qa`
   - verify audit rows + atomic behavior, then `--rollback --run-id=qa_rehearsal_1 --env=qa`
   - re-apply, then `--verify --env=qa` until clean.
7. **Apply 023 to QA** and re-test with the unique indexes active:
   checkout, webhook create/update, cancellation, new-customer creation;
   confirm ledger rows go processing→processed and a forced failure stays
   `failed`/retryable.
8. **STOP — owner approval gate before any production step.**

## Step 2 — Production

9. Merge the same hotfix branch → `main` (PR).
10. Back up prod D1:
    `npx wrangler d1 export jobhackai-prod-db --remote --output=backups/prod-pre-hotfix.sql`
    + record Time Travel bookmark.
11. **Apply 022 to production (before deploy — hard dependency).**
12. Deploy `main` → production.
13. Verify: Stripe webhook deliveries stay 200; `/api/plan/me` returns the
    paid tier for the two legitimate subscribers; no unexpected wrong-mode
    warnings; `SELECT status, COUNT(*) FROM stripe_event_ledger GROUP BY 1`
    shows events processing→processed.
14. **Preflight (dry run, zero writes):**
    `node app/scripts/billing-reconcile.mjs --preflight --env=prod --report=prod-preflight.json`
15. Confirm the report identifies exactly the approved records (expected: 2
    LEGIT, 12 repair-class rows). The row identities are runtime data from
    this report — the operator builds the allowlist file from it.
    Any `CUSTOMER_ONLY_UNLINKED_SUB` rows (owned customer with a live but
    never-linked subscription, or an unverifiable subscription list) are in
    NEITHER set: apply cannot free them and the allowlist rejects them —
    resolve manually by relinking the subscription id, then re-run preflight.
16. **STOP — owner approves the preflight report + allowlist file.**
17. Apply:
    `node app/scripts/billing-reconcile.mjs --apply --allowlist=prod-allowlist.json --run-id=prod_repair_1 --env=prod`
    (re-verifies against live Stripe in-process; aborts on any drift; one
    transactional batch; audit before/after images per row.)
18. Verify: exactly 2 rows with active paid entitlement; their period dates
    populated; the 12 repaired rows free with no Stripe IDs;
    `SELECT COUNT(*) FROM users;` unchanged (nothing deleted);
    `SELECT COUNT(*) FROM billing_repair_audit WHERE run_id='prod_repair_1';`
    matches touched-row count.
19. `--verify --env=prod` clean → **apply 023 to production**.
20. Monitor Pages logs + Stripe deliveries + `stripe_event_ledger` failed
    rows for several days:
    `SELECT * FROM stripe_event_ledger WHERE status='failed';` — failed rows
    after Stripe's ~3-day retry window need operator resolution
    (reconciliation script or manual review).

## Step 3 — dev0 integration (voice work preserved)

21. Merge the production release (`main` = `ed00ca6`, PR #856) → `dev0` on
    an integration branch, reviewed locally before any push. What the
    integration branch does (all unit-tested; see `npm run test:billing`):
    - **Webhook**: hotfix architecture (mode gate → ledger claim → staged
      writes → one atomic batch) is the base; dev0's Interview Pack path is
      ported as `stagePackGrant`. mode=payment sessions never reach plan
      mapping; the credit UPDATE, the legacy `stripe_event_log` INSERT and
      the ledger processed-mark commit together; an event the pre-ledger
      webhook already granted (row in `stripe_event_log`, none in the
      ledger) is recorded as processed and never re-granted. Both tables
      stay: the ledger is the authoritative idempotency record, the legacy
      log the pack-grant history.
    - **Recipient-guarded processed-mark**: an event is never marked
      processed when a staged users-row write found no row at commit time
      (row deleted between `ensureUserRow` and the batch) — the whole batch
      rolls back and Stripe retries (`recipient_row_missing`). Tombstoned
      accounts stay deliberate no-ops; `subscription.deleted` and
      `invoice.payment_failed` no-op explicitly when there is no row.
    - **Fulfilment eligibility**: a Checkout Session grants entitlement only
      when the re-fetched session is `status=complete` and `payment_status`
      is `paid` or `no_payment_required` (100% promotion code). A completed
      session still `unpaid` (delayed payment methods) is a recorded no-op;
      `checkout.session.async_payment_succeeded` fulfils it (same handler,
      its own ledger row) and `async_payment_failed` fulfils nothing. A
      subscription-mode session fulfils only through its subscription and
      only while that subscription is in an entitled status. **A fabricated
      or replayed "completed" event for a session Stripe still shows open or
      expired can never grant anything** — which is also why a synthetic
      completion is not an acceptable smoke test of the deployed webhook.
      Dev's Checkout offers card, Link, Cash App Pay, Amazon Pay and Klarna
      (all immediate); if a delayed method is ever enabled, the endpoint
      must subscribe to the two `async_payment_*` events.
    - **Invoice shape**: this Stripe account's default API version and the
      pinned endpoint versions (2025-07-30.basil) put the subscription id and
      its metadata under `invoice.parent.subscription_details`; the webhook
      reads both shapes. (The shipped hotfix reads only `invoice.subscription`,
      so today production and QA record dunning from
      `customer.subscription.updated` but never from `invoice.payment_failed`
      — flagged for the next production release.)
    - **Plan maps**: weekly/monthly are subscription plans wherever the
      hotfix introduced a legacy-only list; `pack` is deliberately NOT a
      subscription plan (pack rows classify KEEP/FREE_CLEAN, repairs keep
      `plan='pack'`); voice credit columns are never `BILLING_FIELDS`.
    - **KV markers** (`evtl:`/`processing:`) are scoped by ENVIRONMENT and
      the **environment stamp/gate** (`metadata.environment` on Checkout
      Sessions and the subscriptions they create; foreign-stamped events
      acknowledged with zero writes) is **defence in depth only**: an
      environment running code without the gate — QA today (`develop`,
      unstamped hotfix webhook) — still processes the other environment's
      objects. Verified by local replay: the unchanged webhook turns a dev
      pack purchase into `plan=essential/active/no subscription` (creating
      the user row) and a dev monthly subscription into `essential`.
      Isolation therefore comes from configuration (below), not from this
      code.
    - **Reconciliation CLI**: `--stripe-account=acct_…` is required for
      preflight/apply and verified against `GET /v1/account` before any row
      is inspected; the report and allowlist record the account; `--apply`
      refuses an allowlist made for another account, and refuses a set in
      which (almost) every verified object is missing unless
      `--acknowledge-mass-not-found` is passed for an explicitly reviewed
      legacy reset — a cross-account 404 is never authorization to
      downgrade. Credential MODE is enforced per target (prod live, qa/dev
      test) before any network access. `--rollback` refuses to restore
      duplicate ids while 023's unique indexes exist and prints the order.

    **Dev isolation cutover (2026-09-06 takeover revision).** Keep this
    sequence intact. A new Stripe account returning 404 for an old customer
    is not evidence that the old subscription was invalid.

    1. Verify live Pages configuration, deployed SHA, actual worker bindings
       and schedules, D1 schema and Stripe account identity. Dev currently
       uses D1 `c5c0eee5-a223-4ea2-974e-f4aee5a28bab`, has 99 users, and
       lacks 022/023. Dev and QA share KV `5237372648c34aa6880f91e1a0c9708a`
       and Stripe test account `acct_1RymDCApMPhcB1Y6`. The existing isolated
       sandbox `acct_1RymDIAErdLV6piR` has three legacy prices, one customer,
       no subscriptions and no endpoints. Audit it before reuse. Dedicated
       dev KV `06a6323598244fc8a1b2daadeec8a043` is empty. The deployed dev
       retention worker currently has no bindings or schedules; no dev
       inactive-account worker exists. Do not activate cleanup jobs by
       deploying repository configuration as part of this cutover.
    2. Complete candidate tests and review the integration diff. Create a
       PR to dev0 with `[skip-e2e]` in its initial body. Candidate billing,
       migration and ATS jobs validate checked-out code. Hostname E2E runs
       exercise the currently deployed app and can change storage, so run
       them only after the cutover is consistent. The manual `ui` suite
       contains marketing/auth navigation and terms checkpoints; it is UI
       smoke, not read-only. Resume upload/scoring is excluded.
    3. Freeze dev traffic before taking the final snapshot: protect the
       custom hostname, the project pages.dev hostname, and old immutable
       deployment/branch aliases. Verify denial on each. A middleware flag
       in a new deployment does not protect old deployment URLs. Stop any
       actual scheduled writers and allow in-flight work to finish. Record
       pending Stripe deliveries; disable only the old account's dev
       endpoint after accounting for them. QA and production endpoints and
       shared-account customers/subscriptions remain untouched.
    4. Export dev D1 and capture a Time Travel bookmark and configuration
       before-images. Re-run reconciliation pinned to the OLD Stripe account
       and review exact before/after rows. Preserve legitimate entitlements,
       trial flags, payment history, voice credits and resume records. Apply
       022 once, after verifying all its objects are absent, before deploying
       any hotfix code. Apply the reviewed stale-billing repair with audit
       records and dev-only cache invalidation; never invalidate shared KV.
    5. Copy only proven dev-owned persistent KV records into dedicated dev
       KV, preserving metadata/expiration. Derive resume ownership from D1
       raw_text_location references; a shared Firebase uid alone is not
       proof. Copy needed dictionary data and unambiguous dev counters and
       trial gates. Rebuild deletion markers from dev tombstones with their
       remaining lifetime. Do not copy old customer caches, billing caches,
       webhook markers or QA-only records. Keep source KV unchanged.
    6. Prepare sandbox products/prices, portal configuration and a dev-only
       webhook including async payment success/failure. Recreate retained
       dev customers and legitimate test subscriptions in the sandbox and
       record an explicit old-to-new mapping. Preserve plan and remaining
       entitlement/cancellation time. Audit the D1 remap atomically with
       before-images and drift guards. Do not reset valid subscriptions to
       free, cancel shared-account subscriptions, or infer invalidity from
       cross-account 404s. Complete the remap before reopening dev traffic.
    7. Update dev Pages Production to dedicated KV and sandbox secret key,
       signing secret, both publishable-key variable names, all six price
       variables and STRIPE_PORTAL_CONFIGURATION_ID_DEV. Keep previews
       disabled. Deploy the reviewed dev0 merge with DEV_CUTOVER_PAUSED=true;
       this flag returns 503 before any storage access on dev only. Verify
       the deployed SHA/configuration and migration state. Reconcile against
       the sandbox, verify zero duplicate groups, then apply 023 and verify
       both partial unique indexes. All account mappings must be coherent
       before the maintenance gates are removed.
    8. Reopen only current dev traffic and retain protection of old aliases.
       Exercise genuine sandbox Pack and Monthly Checkout payments. Match
       actual Stripe delivery IDs to processed D1 ledger rows and resulting
       credits/plans/periods. A distinct async/completed pair for one Session
       grants a pack only once: the event record, Session fulfilment marker,
       credit update and ledger processed mark share one transaction. Replay
       a delivery and verify zero additional credit. Start a voice session
       and verify credit consumption, test portal cancellation, then run UI
       smoke (`target_env=dev`, `suite=ui`). Capture QA before/after evidence
       and distinguish unrelated concurrent activity from dev-origin writes.

    **Rollback:** keep dev traffic paused while restoring a consistent set
    of code, D1 mappings, Stripe settings and KV bindings. Drop 023 unique
    indexes before any restore that reintroduces duplicate Stripe IDs;
    retain 022 while hotfix code is deployed. Re-enable the old dev endpoint
    only with the old account configuration and matching D1 rows. After
    reopening traffic, fresh writes in dev KV/D1 must be reconciled before
    reverting bindings or using Time Travel; an old snapshot alone would
    discard them. Preserve all evidence and new sandbox objects until the
    rollback decision is complete.

    Execution evidence and exact run IDs are recorded in the gitignored
    `backups/dev0_integration_evidence/` directory. Only completed checks
    belong in the final results; planned acceptance is not deployment proof.
22. Voice release follows its own flow (dev0 → develop → QA → main).

---

## Rollback

- **Code**: redeploy the previous `main` build (Pages "rollback to previous
  deployment") or `git revert` the merge. Safe: 022 is purely additive and
  old code never references the new objects.
- **Order when restoring data that contains duplicate Stripe ids**
  (the repair dissolved duplicates, so a full data rollback re-creates them):
  1. Roll the code back if the deployed build depends on the change.
  2. Drop migration 023's unique indexes and restore the ordinary index:
     `DROP INDEX IF EXISTS idx_users_stripe_customer_id_unique; DROP INDEX IF EXISTS idx_users_stripe_subscription_id_unique; CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);`
     With the indexes in place the restore batch is refused (atomically —
     nothing lands); the CLI detects the collision first and prints this
     order.
  3. Run the data rollback (below).
  4. Retain 022 while any hotfix code is deployed. Only after the code is
     rolled back may 022 itself be dropped: `ALTER TABLE users DROP COLUMN
     current_period_start; DROP TABLE billing_repair_audit; DROP TABLE
     stripe_event_ledger;` **Never drop the ledger while hotfix code is
     live.**
- **Data**:
  `node app/scripts/billing-reconcile.mjs --rollback --run-id=<id> --env=prod`
  restores every touched row's before-image from `billing_repair_audit` and
  writes mirror audit rows. Last resort: the step-10 `wrangler d1 export`
  dump or D1 Time Travel to the recorded bookmark (whole-DB restore — loses
  post-repair writes).

**Rollback triggers**: a legitimate subscriber loses paid access; webhook
delivery failures spike; wrong-mode warnings for genuine live events;
reconciliation touched anything outside the allowlist (the audit table shows
exactly what was touched).

## Operator queries (cheat sheet)

```sql
-- stuck events needing attention
SELECT event_id, event_type, attempt_count, received_at, last_error
FROM stripe_event_ledger WHERE status='failed' ORDER BY received_at;

-- 023 gate (must return zero rows, both queries)
SELECT stripe_customer_id, COUNT(*) FROM users
WHERE stripe_customer_id IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1;
SELECT stripe_subscription_id, COUNT(*) FROM users
WHERE stripe_subscription_id IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1;

-- who currently holds paid entitlement
SELECT id, plan, subscription_status FROM users
WHERE subscription_status IN ('active','trialing') OR plan != 'free';
```

## Known non-goals / notes

- The two shell scripts `set_pages_qavars*.sh` DELETE `STRIPE_SECRET_KEY`
  from Pages while deployed code reads it from Pages env — do **not** run
  them during this rollout.
- `has_ever_paid` reset and `trial_ends_at` clearing are per-row allowlist
  flags (`reset_has_ever_paid`, `clear_trial`) — owner decides at allowlist
  approval time (default: preserve `trial_ends_at`, it blocks trial re-use).
- The webhook adds a `claimed_at` column to the ledger beyond the originally
  listed fields — it implements the approved claim-timeout (stale-claim
  recovery) without overloading `received_at` (first receipt).
