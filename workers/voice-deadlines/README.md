# Managed voice deadline worker

Draft only. Nothing in this folder deploys automatically. Managed voice and
deadline scheduling remain disabled remotely; production release is held.

Staging update, September 20: migration028 is now applied and verified in dev
and QA, after private backups and tests against both database copies. It remains
unapplied in production. The worker itself is still undeployed and unbound;
matching private OpenAI keys and the old-issuer cutover remain pending. See the
[cutover record](../../docs/voice-managed-cutover-2026-09-20.md). Earlier statements
below about an unapplied migration describe the implementation increment.

One SQLite-backed Durable Object per interview persists an alarm at the
original D1 deadline. The authenticated Pages handler must receive its RPC
acknowledgment **before** creating or replacing a provider call. A missing
binding, disabled scheduler, wrong database/owner, mismatched issuing-key hash
or lost scheduling receipt therefore consumes no new interview. Retrying uses
the existing interview ID and deadline. This is a known setup conflict (409),
not an uncertain provider mutation that needs an account-operation hold.

At expiry the alarm first persists close intent, then claims and hangs up the
recorded active call through the existing exclusive D1 provider ledger. End,
deletion and alarm execution cannot each dispatch that same hangup. A delayed
create cannot reserve credit or release its answer after close intent. This
does not create or score a report: completion separately persists the browser's
transcript and usage.

## Failure behavior

- Alarms are at least once; they are not an exact wall-clock execution SLA.
  Cloudflare or provider outages can delay termination. Real QA must measure
  alarm lateness and provider closure, including an abandoned browser.
- Each due execution saves a new observation alarm before D1/provider I/O.
  Storage failures and creating/closing attempts remain observable. Active
  calls can be claimed only once. Unknown/404/timeout hangups retain the D1
  hold and a `review` object receipt, without repeating the provider mutation.
  Review alarms check only D1 recovery receipts every five minutes. They never
  contact the provider; unresolved or failed observations keep the hold.
- Disabling `VOICE_DEADLINES_ENABLED` blocks new arms, **not** existing alarms.
  Do not delete this worker, namespace, binding or issuing key while calls or
  unresolved receipts remain. Key rotation must drain/reconcile old calls first.
- Confirmed closure removes the object data. Pending objects store only the
  interview UUID, original deadline and operational status. They contain no
  UID, email, provider ID, API key, SDP, audio, transcript or report. Recovery
  tooling records verified D1 closure through the private
  [voice recovery command](../../docs/voice-call-reconciliation.md); the next
  review alarm removes object state when all call/legacy holds are resolved.
  Actual provider evidence and disposable QA recovery remain unverified.
- There is no public scheduling, hangup or inspection endpoint. The default
  Worker fetch handler returns 404. Alarm logs contain an interview UUID and
  coarse outcome only; provider/SQL exceptions are not logged.

## Development and QA cutover prerequisites

1. Review the whole managed-call change and selective migration028. Neither
   the migration nor these workers has been applied by this increment.
2. Privately configure the **same** `OPENAI_API_KEY` as the corresponding
   Pages app. Scheduling compares SHA256 identities without transferring or
   storing the key. Dev and QA bind their own D1 databases and DO namespaces.
3. Deploy the reviewed worker to dev, then QA, initially with scheduling false.
   Bind the Pages application as `VOICE_DEADLINES` to class `VoiceDeadline`
   in `jobhackai-voice-deadlines-dev` or `jobhackai-voice-deadlines-qa`.
   Redeploy Pages for its binding to take effect. No production configuration
   is supplied here; production needs the final concrete release approval.
4. Coordinate disabling/draining every old credential issuer and deployment,
   existing reusable client secrets and untracked calls. This worker cannot
   retroactively control a provider ID the app never observed.
5. Enable the scheduler only after its private configuration is verified, then
   enable managed transport on the reviewed app revision. Verify real provider
   creation, one credit reservation, reconnect, End/expiry races, browser
   abandonment, no duplicate hangup, saved reports and actual usage costs.
6. Human ending/naturalness acceptance, live unknown/legacy recovery, operational
   monitoring and the broader billing/Analytics release gates remain open.

The staging monitoring query and the existing hourly owner-notification route
are described in [voice operational follow-up](../../docs/voice-operational-monitoring.md).
An empty ledger before deployment is not evidence of healthy live calls. The
heartbeat observes only; it never retries or clears an uncertain provider action.

## Local verification

`npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, and
`npx wrangler deploy --dry-run --env qa` perform no deployment. Tests use the
actual Workers runtime, real DO RPC/alarms and local D1 with schema migrations;
all provider calls are intercepted. Test fixtures advance the saved due time
to avoid a 20-minute sleep. They do not prove live scheduling punctuality,
provider responses or microphone behavior.

The test pool's Miniflare is pinned to the version bundled with Wrangler4.135
because its default older runtime rejects this worker's compatibility date.
Sharp0.35.4 overrides the test dependency's vulnerable transitive version.
The lockfile and dry-run/type/runtime checks validate this toolchain together.

References checked September20:
[alarm delivery and retries](https://developers.cloudflare.com/durable-objects/api/alarms/),
[Pages Durable Object bindings](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects),
[Workers testing](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/).
