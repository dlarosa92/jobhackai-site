# Decision board API

All endpoints require verified Cloudflare Access authentication. Owner POST requests require same-origin JSON. Machine identities are exact verified Access `common_name` values mapped to capabilities in the `DASHBOARD_MACHINE_IDENTITIES` JSON binding. Raw identity headers, foreign/expired JWTs and unlisted tokens are rejected. Never put secrets in this binding; client IDs are not secrets.

GET `/api/work-items` returns the canonical board, source freshness and recent coordination. GET `/api/work-items/:id` includes decision history. GET `/api/operating-guide` supplies versioned operating context. GET `/api/session` returns the authenticated role. Machines cannot read or mutate cost/production-ledger endpoints.

POST operations under `/api/work-items/`:

| Operation | Capability | Contract |
|---|---|---|
| prepare | prepare | `id`, `source`, `sourceId`, `expectedVersion` (0 for new), `document` |
| reconcile | reconcile | `id`, `expectedVersion`, `sourceRevision`, `checkedAt`, `nativeState`, optional complete `snapshot` |
| capture-native | reconcile | Empty object; cache the successful directory feed for failure fallback |
| source-health | reconcile | `source`, `expectedVersion`, `status`, `checkedAt`, `evidenceUrl`, `detail`, `maxAgeMinutes`, `requiresMac` |
| contribute | contribute | `id`, `department`, contribution `expectedVersion`, `recommendation`, `evidence` HTTPS URL array, `nextAction` |
| rank | coordinate | `id`, `expectedVersion`, integer `priority` (lower first) |
| coordination | coordinate | stable `id`, `cadence`, `period`, `assessments`, `worked`, `failed`, `adjustments`, `evidence` |
| feedback | owner only | `id`, `expectedVersion`, `revision`, unique `requestId`, `action` approve/changes/decline, `note` |

Document fields: title, department (marketing/sales/product), product (core/local), preparation (up_next/in_progress/ready/blocked/complete), channel, contributors, expectedValue, effort, dependencies (canonical work IDs), nextAction, completionCriteria, reason, impact (customer/commitment/growth), sourceRefs (`{id,url}`), optional blocker.

Snapshot fields: complete:true, conflict:false, sourceRevision, checkedAt, verifiedBy (at most 200 characters), text, html, destination, subject, timing, media (`{url,digest,alt}`), links (complete HTTPS URLs including tags), evidence (`{id,url,fact}`). Empty media/links arrays must be explicit. At least one evidence record is required. Snapshot content is immutable; changed substantive content produces a new digest and decision requirement. Freshness is separate from content identity. Approval requires a draft, ready preparation, current source health, checks within 24 hours and completed dependencies. Native source feeds retain authority over Gmail, directory and outreach status.

Canonical source references for existing records: campaign/campaign_items.id, gmail/native thread ID, outreach/outreach_messages.id, directory/directory-prefixed ID. A unique `(source,source_id)` constraint prevents duplicate source cards. The work-item projection replaces its matching old card. Do not change a work item's source identity to represent another person/post. Work can be completed or declined without deleting history.

Outreach retains `/api/outreach/prepare`, `/approve`, `/send`, `/cancel`; only prepare is available to machines with that capability. Owner-only `/api/outreach/feedback` accepts id, exact revision, action changes/decline and note. Feedback withdraws current approval and holds that revision; a different prepared revision requires a new decision. The signed relay, source/routing checks, suppression and one-attempt protocol remain authoritative.

Metadata-only reconciliation retains the saved review packet and its decision when the source revision is unchanged. A different source revision without a complete replacement snapshot removes it from current review while retaining historical packets and decisions.

Operations, GitHub and analytics tasks with complete preparation satisfy dependencies only after their prerequisite chain and explicit blockers are resolved. Content preparation alone never means publication or sending.

409 means reload and reconcile; never blind-retry an obsolete version. Approval and preparation never execute publication or sending. There is no machine cost, access-admin, approval or release API.

Local executors can use `node scripts/dashboard-client.mjs get /api/work-items` or `post /api/work-items/prepare /private/path/packet.json`. It reads a mode-600 credential file at `~/.local/share/jobhackai/dashboard-access/credentials.json` (or the `JOBHACKAI_DASHBOARD_CREDENTIALS` secret-file path) containing `origin`, `clientId` and `clientSecret`. Install credentials separately through each executor's secret facility. It refuses owner routes and redirects. Monitor service-token expiry and rotate in the executor secret store; a long browser session does not renew machine credentials.

## Execution and follow-up API

GET `/api/workflow` returns execution health, open decision handoffs and active alerts, which are also included in the board's `workflow` object. It additionally returns `preparationQueue`: `eligibleCount`, up to 20 eligible item summaries (`id`, `title`, `department`, `nextAction`), and `awaitingOwner` IDs for complete review-ready packets. The summary limit is not a workload cap; use the full board for the remaining items. Source freshness and run success are separate. GET does not manufacture a completion timestamp.

Excluding an external hold from eligible preparation requires both `preparation: "blocked"` and a nonblank `blocker` explaining the verified obstacle. A blocker note on `in_progress`/`up_next` work, or a blocked classification with no reason, cannot hide it from the queue. Handoffs whose native work is already sent, published, closed or scheduled remain in history but do not block preparation completion.

`awaitingOwner` includes prepared outreach packets using their separate approval/release workflow. It does not imply permission to release an approved packet. Unread Gmail and directory notifications remain on the board but are not prepared packets and are excluded from this list.

- POST `/api/workflow/start`: `{workflow: "preparation" | "reconciliation" | "coordination"}`. Requires the corresponding prepare/reconcile/coordinate capability. Server-selected UTC half-hour for reconciliation, UTC hour for preparation, or Eastern date for coordination; retries return the existing ID/status, never duplicate a run. Save the returned `id`. A running run can resume until `leaseUntil`; a finished/expired run cannot be rewritten. Reconciliation keeps a one-hour lease but rejects a new period while a previous reconciliation run is active (409). Read status and wait for the next scheduled check; do not start concurrent work or extend the lease. Legacy hourly receipts retain their identity and occupy the half-hour in which they actually started.
- Include that `runId` in every scheduled `/api/work-items/prepare`, `/reconcile`, `/source-health` and `/coordination` write. The API verifies the active run's identity and records only that run's successful writes. Unattributed manual writes remain supported but cannot satisfy a scheduled receipt. Concurrent workflows cannot borrow each other's checks or artifacts. A failed receipt write leaves the work saved but the run incomplete; reload before proceeding.
- POST `/api/workflow/finish`: `{id, outcome: "advanced" | "checked" | "blocked" | "failed", summary, evidence: [{url,fact}], blocker?, nextCheckAt?}`. Only the starting identity can finish. Successful reconciliation and preparation require fresh source/item checks attributed to this run; successful coordination requires its own daily assessment for the server-selected date. Advancement requires a changed artifact owned by this run or completed handoff. Preparation cannot report `checked` or `blocked` with eligible unfinished work, including items whose prerequisite chains are now complete. Finished packets awaiting owner review and unchanged approved packets awaiting separate release are excluded from that preparation backlog; open decision handoffs are checked separately. Blocking requires a concrete reason and a future checkpoint within seven days. Record each affected item's verified external obstacle before a global blocked result; ordinary copy, source, media or timing checks remain preparation work. Failure requires a summary and remains unhealthy. No external execution is implied.
- POST `/api/workflow/handoff`: `{runId, decisionId, expectedVersion, action: "claim" | "block" | "complete", summary?, evidence?, blocker?, nextCheckAt?, resolution?}`. Requires preparation capability and an active preparation run. Claim first, then use the returned handoff version. Complete requires current source health and a complete ready snapshot. `resolution: "revised"` requires changed content; `"verified_for_release"` requires the unchanged approved revision and does not release it. Requested changes always require a revised packet. Block requires evidence, reason and checkpoint. Concurrent, expired or superseded claims fail with 409.

Decision creation and handoff creation are atomic. New owner decisions supersede previous open handoffs. Historical decisions, snapshots and handoff results stay intact. Approval notes are routed for assessment rather than silently interpreted as release authority. Current incomplete handoffs replace obsolete “review again” instructions on cards and prevent premature approval of unfinished revisions.

## Rolling Analytics import

GET `/api/analytics` returns the latest saved aggregate observation and `current`, `stale` or `not_connected`. The board includes the same `analytics` object. Reconciliation POSTs `/api/analytics` with:

`{property:"523348532", windowDays:28, startDate:"YYYY-MM-DD", endDate:"YYYY-MM-DD", checkedAt, sourceUrl, events:[{name,count,users}], campaigns:[{source,medium,campaign,content,sessions,contactIntentSessions}], kitActions:[{asset,action,count}], coverage:{internalTrafficExcluded,attributionVerified,purchasesReconciled,campaignBreakdownComplete,kitActionBreakdownComplete}, notes}`

Dates must cover the current 28 days ending yesterday in America/New_York; sourceUrl must be the native production Analytics report and checkedAt within two hours. Supply every coverage flag explicitly as a boolean, use only observed aggregate rows and no personal data. Missing events are unverified, not fabricated zeros. Empty campaign/action arrays mean no imported breakdown, never zero activity. Preserve previous reports on access failure and record analytics source health as unavailable/incomplete. Updating a report does not satisfy measurement acceptance or prove collected purchases.

## Immediate completion and protected release evidence

`GET /api/work-items/changes` returns `{revision}`. It is authenticated, uncached and inexpensive. Database triggers increment the revision in the same transaction as board changes, including native Gmail/outreach writes. The visible page checks every two seconds and fetches work only after a change; action responses also refresh immediately. Numbers load independently. This measures time after the dashboard receives a verified result, not time before an external platform reports it.

`POST /api/work-items/receipt` requires owner access or the existing `reconcile` capability. It records evidence, never performs or authorizes the external action:

```json
{"id":"canonical-item","expectedVersion":4,"eventId":"provider-unique-event-id","candidate":"immutable-accepted-content-id","stage":"dev_deployed","evidenceUrl":"https://github.com/owner/repo/actions/runs/123","summary":"Exact deployment verified; acceptance remains pending.","occurredAt":"2026-10-31T12:00:00.000Z"}
```

Deployment stages must arrive in order for the same accepted candidate: `dev_deployed`, `dev_verified`, `qa_deployed`, `qa_verified`, `production_deployed`, `production_verified`. Verified means the stage's required acceptance checks passed, not merely that deployment succeeded. GitHub work items use these stages. Other supported sources use `published` or `sent` only after native confirmation. Gmail, outreach and directory continue using their existing authoritative feeds.

Receipt creation and attribution to its originating scheduled run commit in one transaction. A lost response can be retried without leaving an unhealthy run or letting another run borrow the result. Receipts are append-only. Retrying the same event and payload is safe; reusing an event ID with different facts returns 409. Different work/candidates need a new work item. Completed records remain in Done and history. Preparation cannot erase their result. Once a receipt exists, reconciliation must supply the same `candidate`, preventing an unrelated historical PR check from refreshing the release. Preparation also retains previously saved source references.

The chat or integration carrying out an authorized action must write the result and read back the item before reporting success. A failed receipt must be retried without repeating the publication/send/deployment. Half-hour reconciliation recovers missing observations; it is not the normal notification path. Existing external publication authorization is unchanged.

Apply migration `007-dashboard-integrity.sql` (receipt/revision tables) before deploying. Deploy both dashboard and Gmail-ingestion Workers with trigger-inclusive write-count checks, preserving their private bindings. Only then apply `008-dashboard-change-triggers.sql`. This order keeps old Workers from mistaking trigger side effects for write conflicts. The migration is repeatable and leaves existing decisions, sends and suppressions intact. Use isolated development and QA databases for synthetic acceptance tests. Do not create fake production publications to test the board.
