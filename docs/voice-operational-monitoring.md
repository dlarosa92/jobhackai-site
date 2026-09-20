# Voice operational follow-up

The existing hourly **JobHackAI decisions** heartbeat is the interim notification
route in the owner's current task. It observes; it never starts a microphone,
creates/hangs up a provider call, changes a ledger, retries an uncertain mutation,
rotates a key or sends customer messages. It is not real-time paging or proof
that Cloudflare alarms run on time. The deadline worker remains responsible for
call termination; the heartbeat must not substitute for it.

## Read-only check

Use the authorized dev/QA scope, pinned Cloudflare account
`fabf4409ef32f8c64354a1a099bef2a2` and these databases:

| Environment | D1 database ID | Pages project | Expected deadline worker |
| --- | --- | --- | --- |
| Dev | `c5c0eee5-a223-4ea2-974e-f4aee5a28bab` | `jobhackai-app-dev` | `jobhackai-voice-deadlines-dev` |
| QA | `80d87a73-6615-4823-b7a4-19a8821b4f87` | `jobhackai-app-qa` | `jobhackai-voice-deadlines-qa` |

1. Read the current canonical Pages revision and deployment configuration,
   and the deadline worker's existence/configuration. Do not print secret values.
   Separate **not activated**, **unknown/inaccessible**, and **active**. Presence
   of source files, a migration or a private report does not establish activation.
   Before calling it active, verify the managed flag, matching environment D1/DO
   binding, worker scheduling flag and the tested candidate revision. A worker
   name alone is insufficient. Do not create resources to make the check pass.
2. Query `sqlite_master` to confirm `voice_interview_controls` and
   `voice_provider_calls` both exist. Missing schema is unavailable monitoring,
   not a zero count. A failed read must remain unknown.
3. Run the single SELECT in
   [voice-monitor-summary.sql](../app/scripts/voice-monitor-summary.sql) with
   Wrangler `d1 execute --remote --json --command` using an explicit account/DB
   config. Use an argument array, not shell interpolation. The existing
   `d1Query` helper in `app/scripts/deletion-execution-reconcile.mjs` pins targets
   and parses SELECT results. Do not use `--file` (bulk import), `--apply`,
   migrations, or any INSERT/UPDATE/DELETE as part of observation.
4. Keep only environment, checked-at time, deployed revision, activation state
   and aggregate counts in normal notifications. No UID, email, provider ID,
   key hash, transcript, audio or report content belongs in the owner alert.

## Interpret and notify

- `uncertain_calls` needs operator evidence review. Never infer closure from
  a provider404, elapsed time, a terminated observer or a zero subsequent count.
- `stalled_operations` identifies creating/closing records unchanged for at
  least five minutes. `overdue_open_calls` identifies provider records still
  open two minutes beyond their original deadline. These are investigation
  thresholds, not an exact provider lifetime or automatic retry permission.
- `inconsistent_open_calls` and `invalid_open_call_timestamps` need investigation.
  An absent owner/control/attempt association cannot be treated as a closed call.
- `legacy_calls_awaiting_drain` needs the separate old-credential/invocation
  reconciliation procedure. Current ledgers do not inventory all old calls.
- Categories overlap. `open_calls` alone may be normal while an interview is
  running. Zero counts before managed activation mean **not yet exercised**,
  not healthy, accepted or drained. Zero counts after activation do not prove
  provider closure, deletion completion or correct alarm delivery.

Bring a new actionable failure directly into the owner's task with the affected
environment, aggregate evidence and next concrete step. Internally investigate
routine issues without requesting an approval. Preserve already-pending key,
Google and human voice requests; do not ask them again. Stay quiet while the
condition is unchanged. If observations become inaccessible after activation,
report the lost visibility once; do not claim there are no incidents. A later
successful observation can resolve the visibility alert but cannot by itself
resolve an earlier uncertain provider mutation.

For a confirmed need to reconcile a call, prepare the private review using
[voice-call-reconciliation.md](voice-call-reconciliation.md). The heartbeat must
not perform the write or invent the required provider/terminal-invocation proof.
Production is outside this staging monitor until the release scope is explicitly
approved. Preserve production, public publishing, outreach and spending holds.

## Verification limits

Local synthetic SQLite checks validate the count classifications. Read-only
dev/QA checks validate schema/query access. Neither proves a scheduled heartbeat
was delivered, an alert appeared, or a live provider call ended. Verify a real
scheduled observation after deployment and record its result before claiming
the operational notification path is accepted.
