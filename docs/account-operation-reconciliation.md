# Reconcile a stopped account operation

Use this procedure when an `active` or `uncertain` operation claim prevents account deletion or exclusive maintenance after the originating invocation has stopped. The operator tool shares the private inspect/plan/apply/receipt workflow described in [deletion-execution-reconciliation.md](deletion-execution-reconciliation.md). Use `--operation=OPERATION_ID` instead of `--job`. These target modes are mutually exclusive. Production application remains held; no recovery mode is enabled by this draft.

Every admitted operation now records its purpose and emits an opaque operation reference for correlation with the platform invocation. The receipt carries purpose/owner/event identifiers and evidence references; it contains no address, credential, transcript, campaign payload or provider response. A claim's age is never evidence that work stopped.

## Determine the outcome from authoritative evidence

Verify the exact invocation is terminal, including registered background work, and that external requests are no longer outstanding. Correlate `account-operation started` with Cloudflare's terminal invocation result. If logs are missing or a provider outcome remains unresolved, retain the hold unless the delivery-only suppression procedure below applies. Use the same private evidence references, observation ordering and 30-minute freshness bound as the deletion execution procedure. For operation mode, `evidence.invocation.executionToken` is the operation ID.

Choose one of these dispositions in the reviewed JSON:

| Disposition | Applies to | Required evidence and behavior |
| --- | --- | --- |
| `verified` | API, webhook, maintenance, or already recorded terminal delivery | Verify the request's provider and local effects, including partial failures, against its actual purpose. Billing requires correct Stripe account/mode, affected object/request IDs, event ledger, entitlements and cache state. Do not infer correctness from an event being present or an HTTP status. `providers.status` must be `settled`. The command records review and finishes the hold without changing provider or financial state. |
| `retry_storage` | Retention only | Verify the retention invocation and its KV/D1 requests are terminal. Review remaining references and ownership. `providers.status` may be `storage_only` or `settled`. Release the hold for the normal retention worker to re-evaluate ownership/eligibility and repeat idempotent cleanup. This is not a receipt of completed retention and does not advance its cursor. |
| `suppress_delivery` | Analytics, voice follow-up, inactivity warning only | Verify the invocation and provider requests have stopped. Delivery may remain unknown, represented by `providers.status: "settled_unknown"`; `pendingRequests` must still be false. Atomically preserve uncertainty, prevent future sending and finish the account hold. Never use this to dismiss an unresolved charge, checkout or subscription mutation. |

For any partial billing/account state, complete the appropriate reviewed repair first, then make a fresh inspection. The tool neither performs that repair nor automatically trusts a provider response. No external request is made by the reconciliation itself. Evidence validation checks structure, correlation, ordering and the exact current snapshot; it cannot prove that an operator's attestation is true.

Additional delivery rules:

- An Analytics `verified` disposition requires an already terminal local record. `accepted_unverified` stays unverified; no Google receipt or revenue is invented. Both verified and suppressed event receipts prevent admission for the same event key even if someone resets the outbox or substitutes another UID. Financial payments/refunds are untouched.
- A follow-up `verified` disposition requires its marker and reviewed `providers.deliveryOutcome: "accepted"` evidence. Suppression preserves or stamps its no-resend marker. Every reconciled follow-up remains fenced even if that marker is later cleared; ordinary account requests still work.
- An inactivity warning is verified only when its accepted receipt, operation ID and user notice timestamp agree. Suppression keeps the warning `needs_review`, does not start a notice period and suppresses future automatic inactivity work for that UID. The user can still explicitly request deletion. Do not remove the suppression to start another notice cycle without separate reviewed evidence and authorization.
- A completion-notification outbox record has no account-operation claim because erasure has already completed. It follows its own no-resend and address-expiry rules; do not invent an operation ID to repair it here.

## Commands

Use a private directory and a new filename for each report:

```sh
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --operation=OPERATION_ID --report=/private/path/inspection.json
```

Copy the inspection to a review file, preserve its snapshot, set `disposition` as above, and fill the evidence fields from the actual incident record. The inspection contains no email address or content. Reuse the evidence format in the deletion-execution procedure, with the operation ID as `invocation.executionToken`.

```sh
# Preview only: current-state reads plus a guarded SQL plan.
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --operation=OPERATION_ID --review=/private/path/review.json \
  --report=/private/path/plan.json

# Apply the reviewed nonproduction outcome, then verify its audit receipt.
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --operation=OPERATION_ID --review=/private/path/review.json --apply \
  --report=/private/path/application.json

# If the apply response is lost, look up its saved ID; do not re-submit.
node app/scripts/deletion-execution-reconcile.mjs \
  --env=qa --operation=OPERATION_ID --receipt=RECONCILIATION_ID \
  --report=/private/path/receipt.json
```

One guarded INSERT and trigger atomically record the evidence, settle exactly the selected hold and preserve any required delivery suppression. A changed claim, owner or related marker/receipt aborts the statement, with no partial audit or release. A late or replayed plan cannot release a new operation. The evidence hash and receipt survive later removal of completed claims, so deleting a claim cannot authorize a resend. The tool never expires a live claim or labels incomplete deletion complete.

## Before activation

Real SQLite tests and worker fixtures must verify each disposition, rollback, concurrent changes, no-resend fences and subsequent normal recovery. Then validate the reviewed candidate in QA with disposable authorized fixtures, including platform-log correlation and actual request termination. These tests do not establish real provider termination. Independent Firebase/Stripe writers, active voice-session handling, scheduled runtime bounds and final deployment review remain release gates.
