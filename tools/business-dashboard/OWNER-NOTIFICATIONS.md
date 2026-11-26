# Private urgent owner notifications

This route emails the fixed owner only for an explicit saved escalation: serious customer harm, uncontrolled spending or a commitment at risk. Routine completed-work, missed-task, stalled-task, restart and recovery updates stay in the dashboard and operations chat. A timer changing state is not a customer incident or proof that work finished.

The recipient remains `sebastian.larosa@jobhackai.io`, from `JobHackAI <noreply@jobhackai.io>`. There is no arbitrary recipient, sender or mail endpoint. Urgent notices use a plain-language issue label, “What happened” and “What you need to do.” Executors must supply a factual plain-English summary of the actual impact and needed review. Old technical timestamps, stale Page links, routine workflow labels and recovery disclaimers are removed from new email templates. Existing accepted messages keep their immutable contents.

## Dependencies preserved

- Authenticated workflow completion saves evidence and handoffs. Only explicit urgent escalation inserts an outbox record atomically with completion and initiates bounded delivery through `ctx.waitUntil`.
- The existing 15-minute monitor still records deadlines and resolves internal alerts. It no longer produces generic warning or recovery emails. Its transport pass retries eligible urgent events and checks historical provider receipts.
- Work evidence, historical alerts, handoffs, outbox records, provider IDs, database schema/migrations, customer emails, monthly reports, Gmail ingestion and board notifications are retained.
- The schema still accepts historical `brief`, `failure` and `recovery` kinds. Do not drop migration 011, its table or immutable-content trigger. No migration is required for this policy change.

## Retired behavior

The routine completion producer, generic monitoring producer, recovery-email producer, their workflow hooks and obsolete supersession-only queries are removed. The dispatcher separately allows only `kind='failure'` with a literal `urgent:` ID prefix, so stale non-urgent writers cannot send queued mail.

On each enabled/configured transport pass, matching-environment non-urgent pending/expired-sending rows are held without deletion. Unattempted rows become `failed` with `routine_notice_retired`, excluded from actionable delivery-review reasons. Attempted rows become `uncertain` with `routine_send_outcome_requires_review` and are never retried. A live lease is left alone until it expires because its provider request may already be in flight. Do not change old payloads, invent replacement event identities or reset suppression.

Accepted/delivered legacy notices retain receipt and complaint polling. Retirement cannot recall an email already accepted by the provider. Old routine-message failures do not authorize restarting generic monitoring mail.

## Transport controls

Each invocation performs at most one provider receipt GET and one eligible urgent POST. Receipt polling precedes sending so newly observed complaints/bounces stop pending sends. Provider bodies are bounded to 64 KiB and requests have ten-second timeouts. Network work is awaited; no new timer, public route or provider webhook is added.

The environment, event identity, subject and body are immutable. Idempotency keys include environment and event ID. Dev/QA subjects retain test prefixes. Unknown urgent send outcomes retry the same key/payload only within 23 hours, at most five attempts, using a claim lease. Expired ambiguous outcomes remain uncertain. Unattempted urgent events expire after 24 hours. Receipt failures never authorize another send.

Provider acceptance is separate from delivery. Delivery requires an exact-ID receipt matching sender, sole recipient, subject, text and no extra recipients. Accepted receipts poll hourly for up to 48 attempts. Delivered receipts retain the independent eight-check/seven-day complaint window. Bounce, complaint or provider suppression stops the route until reviewed recovery. Do not silently clear these records. Later complaints outside that bounded window remain unmonitored.

## Configuration and release

Production is enabled; development and QA are disabled in checked-in configuration. Preserve the exact environment label, dedicated `OWNER_RESEND_API_KEY`, current Access policy, machine identities, workflow policies, D1 bindings and existing cron. Missing flags or credentials fail closed. The dedicated key needs read permission for receipt polling; never copy customer-mail secrets or expand permissions as part of a notification change.

Follow dev0, develop/QA, then main/production. This standalone Worker uses the existing `wrangler deploy --config wrangler.jsonc --keep-vars` path, adding `--env dev` or `--env qa`. Pages deployment does not deploy this Worker. Compare runtime settings before and after, and retain exact candidate and deployed-code evidence. Dev/QA keep empty cron arrays; production keeps `*/15 * * * *`.

The active coordinator already directs routine updates to chat. Preserve that instruction and the separate monthly report workflow. Do not restore generic monitoring/recovery mail from older source or create a replacement scheduler. An emergency stop disables the existing owner-email flag and must be reflected in source; retain the outbox and all receipts.

## Verification

Run `npm run build` and `npm test`. Synthetic transports verify urgent atomicity, scope/auth checks, retries, immutable payloads, environment isolation, leases, provider receipts and complaint protection. Regression checks replay late -> restarted -> stalled work with internal alerts and zero emails, retirement of generic/recovery backlog, stale insertion during dispatch, silent successful completion and all three urgent escalation types.

Use authenticated live reads and downloaded deployed-code checks at each stage. Observe the normal production scheduled checker and saved state after deployment; do not manufacture a production incident or send a test email merely to prove silence.
