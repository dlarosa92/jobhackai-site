# Private owner notifications

This prepares a hosted notification path for meaningful JobHackAI work results and workflow failures. It is **off by default** in production, dev and QA. No credential is installed and no real message was sent by the local tests.

The recipient is fixed in source to `sebastian.larosa@jobhackai.io`. Sender is the existing verified `JobHackAI <noreply@jobhackai.io>`. Every notice links to the existing private company brief as saved context. The message reports its own canonical operating event and does not claim the Page already contains that event; publishing the Page requires its separate saved/read-back receipt. There is no endpoint for selecting a recipient, sender, arbitrary email body or external URL. Existing authenticated workflow completion supplies its bounded saved summary, but cannot override the email envelope or template. This route is operational owner communication only, not customer outreach or promotional authorization.

## Existing trigger, durable records

The existing 15-minute deadline cron remains the only dispatcher. No new scheduler, queue service or platform is introduced. `DASHBOARD_DB.owner_notifications` is a transport outbox, not a second business backlog. Migration `011-owner-notifications.sql` is additive and affects only the dashboard database.

- A successfully completed `advanced` workflow with actual saved work changes or completed handoffs inserts its brief in the same database transaction as the completion receipt. A checked source or huddle alone does not trigger a business-results email.
- Deadline checks atomically record one failure notice per canonical alert episode and one recovery when that episode closes. Repeated unchanged checks remain quiet. Recovery describes a monitoring change, not proof that business work finished.
- A failure resolved before any dispatch attempt is held as `resolved_before_dispatch`; it and its unnecessary recovery are not sent. If a send was already attempted, recovery remains eligible because the failure might have reached the owner.
- Notifications are queued only when the feature flag is explicitly true. Existing historical completed runs are not replayed on activation. Existing still-active alerts may produce their first notice when the route is enabled.
- The same alert episode does not generate an email for each wording change. A resolved and later recurring episode gets a new identity. More elaborate severity escalation is outside this bounded implementation.

## Transport and receipt controls

Each cron invocation polls at most one accepted or delivered receipt and attempts at most one send. Polling precedes sending so a newly observed bounce or complaint stops queued notices. All work is awaited as part of the existing cron promise. Provider bodies are bounded to 64 KiB, calls have 10-second timeouts, and provider error content is not logged.

The event identity, environment, subject and text are immutable. Idempotency keys include the saved environment and stable event identity. Dev/QA subjects have explicit test prefixes. Changing runtime environment cannot retarget or rewrite an existing queued message. Rows created without a valid environment are held as `unconfigured`; they do not automatically become production messages after configuration repair.

`pending` and `sending` do not establish a send. `accepted` retains the exact provider ID and means only provider acceptance. `delivered` requires a separate exact-ID GET matching sender, sole recipient, subject, text and no additional recipients, with `last_event=delivered`. This does not prove inbox placement, reading, phone push or that the private brief itself is current.

Unknown send outcomes retry only the exact saved payload and key within 23 hours of first attempt, with at most five attempts and a claim lease. Provider idempotency lasts 24 hours; the shorter local cutoff leaves a margin. Exhausted/expired attempted messages become `uncertain` for investigation and are never blindly resent. Explicit nonretryable HTTP rejection becomes `failed`. Unattempted notices older than 24 hours expire without sending stale news. A sender crash after possible provider success is recovered using the same key inside the window; no new attempt identity is invented.

Accepted-message read failures never authorize another send. Pending delivery is checked hourly for up to 48 attempts, beyond the provider’s documented 14-hour delayed-delivery window. Delivered receipts continue to be checked daily for seven days from verified delivery, with an independent eight-check budget. Pre-delivery checks cannot consume this later monitoring window. Exhaustion remains accepted with `delivery_receipt_requires_review`, not falsely delivered or failed-to-send. A receipt mismatch becomes uncertain. An observed bounce, complaint or provider suppression stops the route until reviewed operational recovery; there is no automatic suppression reset or resend endpoint. This only covers events observed within the bounded polling window. The atomic send claim also rechecks any previously recorded recipient suppression. After seven days `complaint_monitoring_window_closed` records the gap. Complaints after that window, or beyond provider receipt retention, are not monitored. Comprehensive late-complaint coverage would require a separately reviewed provider webhook or supported suppression lookup; neither is claimed here.

`GET /api/workflow` exposes `ownerNotifications`: disabled, missing configuration, unavailable storage, configured or suppressed, aggregate states and review reasons. Cron emits a separate sanitized `owner_notifications_checked` result. Its `attempted` count means POST attempts, not verified sends. A missing credential does not turn pending records into delivered. Missing schema must be repaired before activation; it is not interpreted as an empty queue.

## Narrow activation prerequisites

1. Follow normal dev0 validation, QA acceptance and specifically authorized production promotion. Apply migration 011 to the matching isolated dashboard DB before enabling the feature. Keep existing schedules, Access controls, receipts and sender approvals unchanged.
2. Install a separately authorized `OWNER_RESEND_API_KEY` secret on the **dashboard Worker**. The implemented polling path requires Resend `full_access`: official API-key documentation says `sending_access` only sends, while `full_access` can read and manage resources. Domain restriction applies only to sending-access keys, so full access has a materially broader blast radius than this fixed-owner code path. A narrow sending key can obtain acceptance but cannot perform the implemented receipt readback. Do not expand permissions silently: the reviewed activation choice must explicitly accept full-access custody, or separately change the design to send-only plus a verified receipt/suppression channel. Existing OAuth readback can independently verify a rollout message but does not prove the deployed key can poll. The production app's existing `RESEND_API_KEY` presence is not permission or a mechanism to read/copy its secret into this Worker. No app secret was read or copied.
3. Preserve exact `OWNER_NOTIFICATION_ENVIRONMENT` (`dev`, `qa` or `prod`) and existing deployed workflow policies. Set `OWNER_NOTIFICATIONS_ENABLED=true` only after concrete release approval. The checked-in values remain false. No public trigger or browser request dispatches mail.
4. Complete a separately authorized owner-only delivery check. Observe the exact provider receipt, actual mailbox message and phone display if claiming phone notification. Verify a real scheduled cycle, one duplicate retry, an uncertain outcome and a missed Mac run. Local tests cannot establish any of these live outcomes.

This extends the existing hosted checker so a missed local task can eventually produce an owner email. It does not independently detect failure of the checker/provider itself. Cloudflare's existing budget/token alerts remain separate and unchanged. Existing Resend webhooks are absent; this implementation uses bounded receipt reads rather than adding webhook permissions or another public route.

## Local validation

`npm run build && npm test` in this directory. All HTTP calls in the new tests are intercepted synthetic transports. Cases cover fixed envelope, no send while off/missing config, immutable payload, concurrency/lease recovery, idempotent uncertain retry and expiry, attempts cap, acceptance versus delivery, receipt mismatch and exhaustion, bounce/complaint suppression before sending, environment isolation, episode/recovery deduplication, and atomic completion/outbox rollback.

These checks use the existing SQLite-backed D1 test harness. They do not substitute for exact-candidate Workers runtime acceptance or actual provider receipt validation.

Primary API contracts checked during implementation:
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Retrieve a sent email](https://resend.com/docs/api-reference/emails/retrieve-email)
- [Cloudflare scheduled handler lifetime](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)

- [Resend API-key permission scope](https://resend.com/docs/api-reference/api-keys/create-api-key)
