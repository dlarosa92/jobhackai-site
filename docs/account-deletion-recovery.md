# Durable deletion recovery — integration in progress

The current handler can remove Firebase sign-in and then fail to delete stored content or KV payloads. Logs and a warning response cannot recover resume storage paths after the account rows disappear. This change begins a durable recovery path; it is not wired to an endpoint or a scheduled worker yet and must not be promoted as a completed fix.

Migration 028 creates a job outside the users foreign-key tree. Its initial snapshot contains the verified UID, original D1 user ID, notification email and KV keys. It deliberately stores no bearer token, Firebase service credential, resume text, interview transcript or scorecard. Preparing the job must succeed before billing or identity side effects.

The storage helper has four phases: prepared, billing_verified, identity_removed and complete. Only the caller that has actually confirmed billing and Firebase results may advance it. A crash or timeout during identity deletion leaves billing_verified; recovery must reconcile the identity instead of inferring success. This phase record does not itself perform those provider operations or certify their outcome.

For an identity-confirmed job, cleanup first makes its storage-key manifest durable and writes the authoritative deletion tombstone. It deletes each KV key without swallowing errors. A failed key leaves every D1 content reference and the job available for retry. A single D1 batch then removes content, the account, consent-owned campaign links and queued Analytics delivery, and records completion. A failed statement rolls back the entire batch. Payment/refund/ledger records remain financial history. Completion clears the recovery email and storage paths; the operational UID receipt and existing fraud-prevention tombstone remain.

The final transaction checks UID/user-ID ownership again; a changed owner rolls back erasure. This is defense against stale recovery data, not an application-wide write lock. New requests, pending Checkouts and webhook races still require the integration below.

## Required before this becomes a release candidate

1. Add durable admission coordination for deletion and in-flight authenticated mutations. Cover both stripe-checkout and upgrade-plan, signed-in content writers, get-or-create and still-valid tokens after Firebase removal. Do not replace this with an unlocked check followed by an external API call. The retired /api/stripe route remains blocked by middleware.
2. Extend the strict billing scan to resolve owned open Checkout Sessions and unsettled payments before identity removal. Expire safe owned sessions, block ambiguous/foreign/pending payment states and rescan subscriptions after expiration. Any failure must preserve sign-in access and accurately report already-completed cancellations. A timed-out external call requires reconciliation, not automatic lock expiry followed by assuming nothing happened.
3. Connect /api/user/delete to manifest preparation, verified phase changes and cleanup. Ensure retries reuse the existing request. Return an honest pending status when cleanup is queued, and never expose provider errors or another user's identifiers.
4. Add a scheduled recovery runner with default audit/disabled mode, exact QA environment bindings, bounded batches and safe concurrent claims. Privately configure its required Firebase/Stripe credentials. Reconcile uncertain identity results using the verified UID; do not store or replay a user's bearer token. Do not re-run billing against an already-completed deletion.
5. Handle completion notification idempotently after cleanup, with failure/retry status independent of whether content erasure succeeded. Define retention for completed operational receipts without silently weakening existing anti-abuse tombstones.
6. Bring the inactive-account worker onto the same verified ownership and recovery path. Keep warning/deletion eligibility distinct from a user's explicit delete request. Its current production version is not proof of this implementation, and its QA worker was absent at the September 20 inventory.
7. Test the actual request handler, restart/lease races, identity timeout/reconciliation, each checkout entry point, late webhook events, missing bindings, notification retry and real deployed QA recovery with a disposable authorized fixture. Only then apply 028 to the approved nonproduction databases and promote reviewed code/worker versions. Production requires the existing final release approval.

## Current validation

Real SQLite tests exercise durable snapshots, missing schema, phase rejection, KV failure/retry, full transaction rollback/retry, tombstone failure, late resume references, changed ownership and Firebase-only accounts. A separate test builds the repository schema plus real supplemental migrations and checks voice erasure, attribution cascades, retained payment/refund rows and foreign-key integrity. Billing CI runs the recovery suite alongside existing cancellation-guard tests.

No live deletion, migration, email, secret entry or recovery-worker deployment has occurred for this change. Human voice acceptance, authenticated QA journeys and the existing QA Google API-secret gate remain independent outstanding release requirements.

## Admission primitives added September 20 (still not endpoint-wired)

The same unapplied migration 028 now also defines durable deletion intents and operation claims. A deletion intent immediately prevents new admitted operations; manifest creation and each recovery phase require all earlier operations to finish. The insertion predicate and deletion-intent insert are serialized by D1, covering either order without an unlocked check-then-write. Completed intent markers survive erasure so an old token cannot acquire a new claim. Completion clears the intent email and finished claims in the same erasure transaction.

Crashed or uncertain operations do not silently expire. There is deliberately no public or automatic "mark finished" escape for an uncertain provider request. The recovery integration must reconcile that request before deletion can proceed. These primitives are not yet an application-wide protection: the middleware, both checkout entry points, get-or-create, webhook handling and background writes must use the admission protocol before deployment. Real SQLite tests cover both operation/deletion orderings, earlier operations, permanent uncertainty, UID isolation, retry identity, missing schema, and manifest/phase refusal without quiescence.

The runner design should reuse the application's already-configured provider credentials through an authenticated internal recovery endpoint where possible. It must not copy user tokens into jobs. Any internal invocation credential, bounded scheduling, replay protection and audit mode still require implementation and verification; no worker or new integration has been configured.
