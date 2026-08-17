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

## Step 3 — Later (not part of this release)

21. Merge hotfix → `dev0`; resolve conflicts preserving voice work
    (expected zones: webhook checkout handler, billing-utils plan maps;
    migrations are 022/023 precisely so voice's 020/021 don't collide;
    reconcile dev0's `stripe_event_log` with `stripe_event_ledger`);
    apply 022+023 to dev D1; run billing + voice regression on dev0.
22. Voice release follows its own flow (dev0 → develop → QA → main).

---

## Rollback

- **Code**: redeploy the previous `main` build (Pages "rollback to previous
  deployment") or `git revert` the merge. Safe: 022 is purely additive and
  old code never references the new objects.
- **Schema (only if forced)**: roll code back FIRST, then
  `DROP INDEX idx_users_stripe_customer_id_unique; DROP INDEX idx_users_stripe_subscription_id_unique;`
  (023, restore the plain index), `ALTER TABLE users DROP COLUMN
  current_period_start; DROP TABLE billing_repair_audit; DROP TABLE
  stripe_event_ledger;` (022). **Never drop the ledger while hotfix code is
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
