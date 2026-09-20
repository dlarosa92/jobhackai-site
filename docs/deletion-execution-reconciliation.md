# Recovering an interrupted deletion execution

This operator procedure is for a saved deletion job whose execution token remains after its Worker invocation stopped. Use the separate [account-operation mode](account-operation-reconciliation.md) for unfinished account, billing, maintenance, email or Analytics claims. The deletion-job mode refuses to release a job while any such claims remain. It cannot mark deletion complete, advance its phase, cancel billing, remove identity, send email or erase content. It releases one verified stopped attempt so the existing processor can recheck its saved phase.

The command is local, defaults to read-only inspection, pins the Cloudflare account and database UUID, and has no public endpoint. Production inspection/planning is supported, but production application is held in code. Migration 028 is required; it remains unapplied as of this draft. Do not activate the recovery worker until the full release gates in [account-deletion-recovery.md](account-deletion-recovery.md) pass.

## Evidence required before releasing an attempt

1. Identify the exact job and execution token. The processor logs `execution_started` with opaque job/execution references, which can be correlated with the Cloudflare invocation. No UID, address, token credential, transcript or provider payload is logged. Preserve the platform invocation reference and terminal outcome in a private incident record. An old timestamp, missing logs, stopped CLI observer or browser timeout does not prove that the invocation stopped. If authoritative terminal evidence is unavailable, leave the token held.
2. Check the authoritative provider outcomes **after** the invocation is terminal. For `prepared`, reconcile any Stripe cancellation/expiration attempts against the correct account/mode and confirm no request remains unresolved. For `billing_verified`, additionally look up the exact UID in the pinned Firebase project and resolve any uncertain delete request; a failed lookup is not absence. Never initiate a new charge or cancel a new subscription as part of evidence gathering. `identity_removed` needs only confirmation of stopped storage work; the recorded phase already establishes the processor's previous identity check.
3. Retain the observations in a private, access-controlled incident record. Use opaque references in the review JSON, not provider response bodies, emails, API keys or bearer tokens. The command validates the review's structure, timing, target and exact snapshot. It **cannot authenticate the truth of operator attestations**; inventing evidence or setting a checkbox to bypass an unresolved provider outcome is not a supported recovery procedure.
4. Evidence must identify the same execution token, show a terminal invocation, show provider observation after termination, and be no more than 30 minutes old when applied. This freshness bound rejects stale evidence; it never grants permission based on a token's age. Outstanding operation claims or changed job/admission state cause an atomic refusal.

## Inspect, review, apply, verify

Use a private directory and a new output filename for every command. Reports are created with mode 0600 and never overwrite earlier evidence. A report contains opaque job/owner/execution identifiers, but not addresses or content manifests. Keep them with the incident record.

```sh
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --job=JOB_ID --report=/private/path/inspection.json
```

Copy the inspection to `review.json` and replace its `evidence: null` only after the checks above. Do not change the snapshot. Example structure (all references/timestamps below are placeholders):

```json
{
  "operatorRef": "operator-or-reviewed-incident-id",
  "invocation": {
    "status": "terminated",
    "executionToken": "EXACT_TOKEN_FROM_INSPECTION",
    "observedAt": "2026-09-20T11:50:00Z",
    "reference": "incident-123/cloudflare-terminal"
  },
  "providers": {
    "status": "settled",
    "pendingRequests": false,
    "observedAt": "2026-09-20T11:55:00Z",
    "reference": "incident-123/provider-observations"
  }
}
```

`invocation.status` is `completed` or `terminated`. For `identity_removed` only, `providers.status` may instead be `storage_only`. The references point to actual reviewed evidence; the example itself authorizes nothing.

```sh
# Read current state and prepare the guarded statement; no database mutation.
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --job=JOB_ID --review=/private/path/review.json \
  --report=/private/path/plan.json

# Explicit internal application, after reviewing the plan and evidence.
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --job=JOB_ID --review=/private/path/review.json --apply \
  --report=/private/path/application.json
```

One INSERT records the evidence hash and references. Its database trigger clears exactly the matching execution token, or the entire statement rolls back. The phase, manifest, original consent and attempt count remain unchanged. The guard checks the snapshot again atomically, plus matching requested consent and absence of unfinished operations. Replayed commands and concurrent applications cannot release a replacement attempt. The audit remains even if subsequent inactivity recovery withdraws the job.

Application saves an `apply_pending` report with the exact reconciliation ID **before** dispatch. If a command times out or its result is uncertain, do not re-run `--apply`. Inspect the saved ID with the read-only receipt command:

```sh
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --job=JOB_ID --receipt=RECONCILIATION_ID \
  --report=/private/path/receipt.json
```

A matching receipt proves the atomic release committed, even if the recovery worker has since acquired a new execution. No receipt during an observation timeout is not permission to retry; establish the database request's outcome, then inspect the current job before preparing a fresh review. A successful release is not deletion completion. Verify the existing processor's subsequent phase/result and completed notification separately in disposable-account QA.

## Validation and remaining limits

Real SQLite tests exercise stale snapshots, changed consent, new operations, replay, overlapping proposals, rollback, quoted identifiers, private reports, lost responses and receipt verification. A processor fixture starts with an already absent identity and a stopped execution, then verifies recovery without repeating Stripe mutations or identity deletion. Local D1 execution and live QA results are recorded in the release log. No test fixture is evidence that a real provider operation stopped.

Unfinished operation-claim reconciliation, independent Firebase/Stripe writers, live voice-session coordination, actual scheduled QA resource bounds and deployed disposable-account verification remain separate release gates. Do not use this tool to clear those gates by bypassing claims.

Database behavior reference: [Cloudflare D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
