# Verified voice-call recovery

**Staging update, September 21:** migration028 and the managed application are
now deployed to dev and QA; production is unchanged. The first owner-authorized
development test failed at 03:01:03 UTC. Its single provider attempt remains
uncertain with no saved call ID. No new voice-session credit was reserved.
Development new-call arms were paused again; QA remains disabled. Existing alarms
and unresolved holds were preserved. No live recovery has been applied.

The diagnostics follow-up records fixed failure phases and HTTP status for future
attempts, plus safe request references in restricted logs. It cannot recover the
missing evidence for the original attempt. Missing provider traces and an elapsed
deadline do not establish non-creation or closure. Capture the prospective Pages
log stream before the next authorized test; never replay the unresolved create.

Migration028 contains receipt tables and atomic guards for this internal operator
workflow. There is no public recovery endpoint, automatic timeout release or
automatic repeat of an uncertain provider request. Production application is
refused by the command.

## What constitutes evidence

Inspect the exact application attempt, execution token, session, issuing-key
hash and environment. Locate the associated Cloudflare invocation and prove
that it is terminal, including registered background work. An HTTP response
alone does not establish this. An old timestamp, browser timeout, stopped log viewer or
missing dashboard entry is not terminal evidence. Then reconcile the provider
outcome after that invocation ended. A provider404 or network timeout alone
does not prove hangup. If authoritative evidence is unavailable, keep the hold.

The provider adapter now logs `provider_created`, `provider_closed`, or a
definite `provider_rejected` receipt **before** its D1 update. Restricted
invocation logs contain the application attempt/execution, validated provider
call ID when present, validated `req_...` request reference and HTTP status.
They contain no key, body, SDP, audio or transcript. These logs can establish
what the adapter actually received when the database write failed. Verify the
deployed revision, invocation provenance, environment and provider reference;
an invented log excerpt or the test fixture is not evidence. Creation alone
does not establish closure. If the known provider call is still running,
resolve it using reviewed provider control before recording closure here.

The command validates the review's structure, freshness, exact target and
unchanged snapshot. It cannot authenticate the truth of an operator attestation.
Keep underlying observations in a private incident record and put only opaque
references in the review. Do not paste keys, tokens, personal information,
provider bodies or interview content into these reports.

## Managed call

```sh
node app/scripts/deletion-execution-reconcile.mjs --env=qa --voice-call=ATTEMPT_ID --report=/private/incident/inspection.json
```

Copy the inspection to a new private review file without editing its snapshot.
Set `resolution` to `closed` or `not_created`. Fill `evidence` with these fields:

- `operatorRef`: an opaque operator/incident reference.
- `invocation`: `status` (`completed` or `terminated`), `executionToken`
  matching the snapshot token, UTC `observedAt`, and `reference`. If the active
  call has no execution token, use its application attempt ID as the correlation
  token and verify the invocation associated with that attempt.
- `providers`: `status` matching the resolution, `pendingRequests: false`,
  UTC `observedAt`, `reference`, `environment` matching the command, and an
  opaque `projectRef` for the actual provider project.
- For this target, `providers` also needs `scope: "one_create_attempt"`,
  matching `attemptId` and `providerKeySha256`, plus `providerCallId`.
  With `closed`, this must match the saved call ID. If creation lost its D1
  receipt, it may be the independently verified closed call ID associated with
  that exact attempt. With `not_created`, both saved and observed call IDs must
  be null, and evidence must prove rejection/non-creation of this attempt.

Provider observation must follow terminal invocation observation, be after
the inspected operation's last update, and be no more than30minutes old at
application. This freshness limit rejects stale evidence; elapsed time never
authorizes release. Never use a different project's/key's result.

```sh
# Read-only proposal; inspect its exact target, evidence hash and SQL.
node app/scripts/deletion-execution-reconcile.mjs --env=qa --voice-call=ATTEMPT_ID --review=/private/incident/review.json --report=/private/incident/plan.json
# Apply only after the authoritative observations above are established.
node app/scripts/deletion-execution-reconcile.mjs --env=qa --voice-call=ATTEMPT_ID --review=/private/incident/review.json --report=/private/incident/applied.json --apply
```

The one INSERT and its trigger atomically record the receipt, close that
attempt and persist End intent. Every inspected call/control field is rechecked
inside the INSERT. Changed ownership, state, token, provider reference,
reservation or control identity causes rollback. A provider ID already assigned
to another attempt cannot be adopted. The operation does not call OpenAI,
create/refund a credit, modify a transcript/report, settle account-operation
claims or clear a separate legacy hold. Remaining holds are reviewed separately.

## Legacy hold

Use `--voice-legacy=SESSION_ID` instead of `--voice-call`. Its resolution is
`legacy_drained`. This needs proof covering the environment's untracked legacy
calls and credentials, not a single visible tab or managed attempt. In addition
to the common invocation/provider evidence above, require provider fields:
`scope: "environment_legacy_calls"`, `issuersDisabled: true`,
`credentialsDrained: true`, and `allInvocationsTerminal: true`.
Use the session ID as the invocation correlation token. Record references to
the reviewed issuer/deployment inventory, credential drain and provider closure
observations. An elapsed20-minute application timer does not supply this proof.

The control must already contain End intent, and all tracked calls for that
session must be closed. The atomic update clears only `legacy_unverified`;
End and the reservation remain. It does not disable issuers or revoke secrets
on your behalf. That coordinated cutover remains a separate release task.

## Lost response and alarm cleanup

Reports are new0600files; an existing path is never overwritten. Application
saves an `apply_pending` report before dispatch. If the response is lost, use
its receipt UUID for a read-only lookup. Do not re-dispatch the saved SQL.

```sh
node app/scripts/deletion-execution-reconcile.mjs --env=qa --voice-call=ATTEMPT_ID --receipt=RECEIPT_UUID --report=/private/incident/receipt.json
```

Pending deadline objects check recovery receipts every five minutes without
contacting the provider. They remove their alarm/data only when no tracked
call or legacy hold remains and the current control is closed with consistent
ownership. This also works after ordinary account cleanup removed closed call
and control rows. Operational closure receipts survive content erasure and
permanently fence reuse of that interview UUID, preventing cleanup from
deleting an alarm belonging to a later call. They contain no user content or
credentials. Normal new interviews use a new UUID.

Local tests cover atomic drift/replay/rollback, exact provider identity,
missing/stale evidence, no financial/report changes, private CLI reports,
lost-response lookup, native D1 triggers and actual DO alarm cleanup. These
tests do not establish a real provider outcome. Actual platform evidence,
disposable QA recovery, operational monitoring and production approval remain
release gates.
