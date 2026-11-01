# Retention cleanup and audit

New deployments default to `RETENTION_MODE=audit`. Only the exact value `delete` enables deletion. Audit reports counts from the same SQL predicates without calling D1 mutation statements or KV deletion. Operator results include pagination cursors; completion logs contain aggregate counts without user IDs, content or object keys.

Do not treat audit counts as completed deletion. The checked-in schedule is hourly (`0 * * * *`), processing at most 25 admitted accounts and 10 resume payloads per account. A full sweep can require multiple invocations. Busy accounts, failed claims and resume backlogs require investigation. The worker has no public HTTP endpoint. Publishing Pages does not deploy this Worker.

## Historical evidence on September 20, 2026

Cloudflare deployment inspection found no `jobhackai-retention-cleaner-qa` worker. The existing development and production deployments were from February, so neither is proof that the current voice cleanup code is running.

A read-only QA database query found two voice sessions, neither older than 90 days. It also found older typed-interview, resume, feedback and question-set records. Those age-only counts do not account for resume reuse or recent feedback and are not a deletion plan. No records were changed by that inspection.

Before enabling deletion, review a current audit, the target D1/KV bindings, retained exceptions and the deployment revision. The October 31 request resumes the staged retention release. Use development and then QA for deployed audit and controlled validation before production activation. Do not turn on deletion simply to test logging.

## Policy details to disclose accurately

- Unpinned LinkedIn runs use their creation time; pinned runs are retained.
- Resume sessions with recent updates or feedback are retained. Old feedback is evaluated independently.
- Saved resume progress snapshots and role-usage history expire after 90 days. Snapshots have no resume foreign key and must be cleaned independently, including when their original resume is gone.
- Old completed voice transcripts, scorecards and supplied role/job context are removed. For a user without current voice access, the newest completed session may retain metadata for the expired-report history entry. A newer incomplete session does not replace that exception.
- These distinctions are not represented by a blanket promise that every stored row disappears precisely 90 days after creation. Scheduled cleanup, manual deletion and retained account/billing/security records are separate mechanisms. Provider retention is also separate.

Both voice history and individual reports withhold expired content even before scheduled cleanup. An authenticated privacy export includes content actually still stored; it must not conceal a cleanup backlog.

## Release procedure

Deployment or deletion activation requires release authorization. Keep `audit` until the exact environment and candidate have been reviewed. Do not bypass `dev0` development, `develop` QA or the QA-accepted `main` production candidate.

For each stage:

1. Record the accepted commit, compiled Worker hash, Wrangler version and test results. Run source and compiled-Worker tests.
2. Verify target D1/KV bindings, migration 028, maintenance/deletion claims and the live schedule. Review a current full audit, including unmapped UID rows and all account pages. Audit does not advance the durable cursor; use the returned `next_user_id` as `afterUserId` until it is zero.
3. Deploy the approved Worker candidate separately from Pages. Explicitly select the approved retention mode. Do not assume merging application code updates this Worker.
4. Read back the deployed version, bindings, mode, hourly cron and enabled logs/traces. Record a real scheduled invocation and aggregate receipt. An HTTP 200 or dry build is insufficient.
5. In development and QA, verify controlled synthetic expiration, preserved exceptions, earlier deletion and export. For production, use read-only before/after verification of legitimate cleanup, not destructive test accounts or old QA results.
6. Publish the matching application notices and update policy dates only at the approved release. Confirm both marketing and application hosts serve the accepted copy.

If any stage fails, stop promotion. Reverting code or switching back to audit cannot restore deleted content. Do not clear an unfinished maintenance claim without the existing recovery evidence and reconciliation procedure.

## Live baseline, October 31, 2026

Read-only inspection found production still on the February 17 Worker version `3f7b96cc-f7c6-4d93-ae6d-60bd8b64a8af`, with monthly cron `0 3 L * *` and no voice cleanup. QA was in audit mode with a daily cron; development had no schedule. These deployments do not prove the current source is operating.

A fresh production query found 38 accounts, seven voice sessions and zero voice sessions or voice payloads older than 90 days. Other existing cleaner categories also had zero age-eligible rows. Expanding the inventory found five old resume progress snapshots with missing parents and seven old role-history entries. Both tables were omitted from earlier cleanup and audit coverage; this candidate adds them. No records were changed. The earlier 35-account audit is historical and incomplete for those two tables. This local candidate is not production activation evidence.

Five snapshots and four role-history entries have clear ownership and no hold. Three other old role-history entries are held by seven unfinished `account/api` claims last updated October 15-18. Those claims require verified recovery evidence. Do not treat their age as permission to release them. `accounts_held` now exposes pre-existing exclusions in every batch receipt, in addition to admission races counted by `accounts_skipped`.

## Failure behavior and validation

Missing bindings/schema and database failures fail the invocation rather than reporting successful cleanup. If deleting a resume payload from KV fails, the remaining database references are retained for retry; other categories already completed earlier in the run may have been deleted. Cleanup across KV and D1 is not a single transaction.

`node --test workers/retention-cleaner/tests/cleanup.test.mjs` exercises real SQLite: audit performs no mutations, deletion preserves pinned/reused/recent records, expired voice content is stripped correctly, reruns are idempotent, and KV/schema/database failure paths retain recoverable references or fail before deletion as applicable. Actual scheduled-handler tests check completion, failure and paused development.

`wrangler deploy --dry-run --env qa --config workers/retention-cleaner/wrangler.toml` verifies bundling and QA bindings without deploying. Runtime scheduling and audit output require separate live evidence.

The Retention safety workflow also checks voice responses, export and account deletion, dry-builds all three environments with Wrangler 4.135.0 and reruns cleanup tests against the compiled QA bundle. Its path filters include export/deletion handlers, entitlement rules and database schemas so changes to those dependencies trigger these checks too. It does not deploy.

The checked-in `tests/runtime.test.mjs` then invokes the compiled scheduled handler in `workerd`, with fresh local D1/KV and synthetic data only. It verifies that audit changes neither content nor maintenance state, deletion removes aged content, recent/reused/pinned records survive, unfinished account operations remain held, and repeated cleanup is safe. It loads no Cloudflare configuration or credentials and removes its temporary database after the check. The module root is set to the bundle directory so this works when the build is outside the checkout, including on CI.

To reproduce the runtime check from the repository root (Node 22+ and Python 3):

```sh
RETENTION_TOOLS=$(mktemp -d)
npm install --prefix "$RETENTION_TOOLS" --no-save --package-lock=false wrangler@4.135.0
"$RETENTION_TOOLS/node_modules/.bin/wrangler" deploy --dry-run --env qa \
  --config workers/retention-cleaner/wrangler.toml --outdir "$RETENTION_TOOLS/bundle"
JOBHACKAI_RETENTION_BUNDLE="$RETENTION_TOOLS/bundle/index.js" \
JOBHACKAI_MINIFLARE_MODULE="$RETENTION_TOOLS/node_modules/miniflare" \
  node --test workers/retention-cleaner/tests/runtime.test.mjs
```

Logs use `retention_batch_complete`, `retention_failed` or `retention_skipped`. `mode=audit` always means estimated counts. A `delete` completion records a successful batch, not a full database sweep. Monitor failures, skipped accounts, unmapped ownership, payload backlogs and missing scheduled receipts.

## Local candidate validation, October 31, 2026

Rebased onto `dev0` commit `2c41753` for the resumed October 31 release. The current candidate has 91 passing source-test results, including the voice-history custom suite, and 20 passing tests against the compiled Worker. All three environment dry builds passed with Wrangler 4.135.0. The common compiled bundle SHA-256 is `b3cfa74f2beec8ad5517aac8554229a3a7dbef57b9054890c17d77289bae0a95`.

The checked-in isolated `workerd` test with actual local D1/KV and repository schemas passed: audit made no content or maintenance-state changes; deletion removed expired voice payloads, old progress snapshots, role history and resume KV payloads; recent, reused and pinned records survived; the expired voice exception contained no candidate content; an unfinished account operation preserved its content; a rerun was idempotent. Only synthetic local records were deleted. These checks do not replace deployed development, QA and production acceptance.

The owner resumed retention and IT verification on October 31. The previous blanket release-hold note is superseded for this staged work. Local checks remain distinct from deployed acceptance. The counts above are audit findings, not deletion receipts. Unresolved operation claims remain protected; the release cannot be described as a completed retention sweep while eligible held content remains. No recovery evidence was found for the October 15-18 operations in the available Cloudflare event query, so none were released.
