# JobHackAI operating guide

Version: 2026-10-24. This guide supersedes older board organization, workload caps and mandatory external-app draft-review instructions. It does not revoke recorded individual approvals or grant external execution.

## Mission and ownership

Grow the software product toward 250 users and verified revenue. User records are not paying customers. Preserve approved Local commitments; evaluate Local outcomes separately. Do not invent an income target.

One shared backlog, one accountable department per item, supporting contributors and explicit dependencies. Customer-impacting failures and commitments come first, followed by evidence-backed software growth. The coordinator sets the cross-department order. Significant unresolved tradeoffs become individual owner decisions. Do not manufacture decisions to keep the board busy.

- Marketing owns content, distribution and lessons from results. Use existing Marblism Sonny and Penny workflows for social and article preparation.
- Sales & Outreach owns researched prospects, partners and individual conversations. Use existing Marblism Stan workflows and the exact outreach gate.
- Product & Technology owns reliability, usability, features, measurement and dashboard defects. Use repository issues, PRs, tests, deployment receipts and monitoring.

Reuse existing employees, tasks and campaigns. The hourly research workflow owns Marblism employee requests; daily coordination must not send duplicate requests. An already-running employee task stays running. Five-per-day, five-item queue, fifteen-minute research and two-hour weekly preparation ceilings were removed by the owner and must not be restored. A short dashboard display is not a workload cap.

## Evidence and review

Read source metadata first; retrieve full changed content only when needed. Prefer APIs, MCP and plugins, then supported native browser access. Stable item IDs and version-conditional writes are mandatory. Keep people and posts separate when decisions are individual.

Every review-ready draft needs complete exact text and any HTML, recipient or destination account, media URLs with immutable revision/digest, all final links, proposed timing, source revision, checked-at time and independent verification evidence. Unknown, incomplete, stale or conflicting snapshots stay in preparation. Do not copy summaries into the complete-copy field. Clicking a card should reveal the complete saved review snapshot inside the dashboard; native source links are secondary.

Reconciliation owns native source status. Department owners own recommendations. The coordinator owns cross-department rank. Sebastian owns approval, request-changes, decline and separate release decisions. Do not mark a draft sent, approval scheduled, or schedule published. Changed copy, media, destination or timing requires a fresh exact decision. Review history remains immutable. A source check failure retains previous evidence and must be reported as unavailable or incomplete, never as zero activity.

Received conversations are reviewed individually. Mark reviewed is tied to the latest native message ID and does not modify Gmail. A new message reopens the card. Review the full conversation before preparing a reply; the metadata preview is not a complete conversation.

## Outreach and permission authority

Use Add a prepared email for review. Stan prepares; Codex independently verifies first-party published email evidence, a current business-fit fact and stable message reference. Sebastian approves the complete exact recipient/copy, then separately requests Send approved email. Generic approvals and historical batch records cannot authorize a replacement message. Never bypass a held gate in Gmail or Marblism.

Reconcile native Sent, replies, drafts and delivery reports across all folders before a possible repeat. Verify domain/MX status and resolve every MX target using the current routing-preflight helper. Nonzero, stale, conflicting or incomplete checks are holds. Routing presence proves neither mailbox existence nor inbox delivery. Bounce, opt-out and uncertain-attempt holds remain until individually reviewed; never automatically retry. One cold follow-up requires its exact separately approved revision, original thread, five complete business days and no reply, draft, failure or prior follow-up. Preserve any narrower weekday or finite-recipient authorization.

Sender installation instructions distinguish an initial read-only installation from a separately authorized activation. Do not treat old 'keep disabled' prose as a command to revoke a later authorized activation, or treat an enabled runtime flag as approval to send. Preserve current settings while reconciling the owner's permission receipt. No reconciliation or department-assessment run may change Gmail permissions, sender flags or release messages. Machine dashboard access cannot approve, release, change costs, administer access or write the production payment ledger.

Preserve the six October 19 sends, all other native receipts, approved revisions, bounce/opt-out restrictions and uncertain attempts. Do not retry to prove that a sync works.

## Attribution and claims

Use validated campaign tags on clickable promotional links: lowercase platform-specific utm_source, appropriate utm_medium, actual utm_campaign and distinct utm_content. Verify saved and published destinations and tag retention through signup and checkout. Shared bio links support aggregate attribution only. Separate visits, clicks, sends, contact intent, replies and verified collected purchases. Do not claim bookings or revenue without their own evidence. Marblism preparation does not authorize publication, scheduling, outreach or spending.

## Coordination and cadence

- Hourly reconciliation inspects changes, records source freshness/failures and advances already authorized preparation. The existing research workflow alone requests work from Marblism.
- Daily coordination records three department assessments, resolves shared dependencies, sets the common priority order and prepares complete owner decisions. Reuse the existing daily decisions schedule.
- Weekly planning and retrospective run within the first daily review of the Eastern calendar week. Record what worked, failed, source evidence and resulting backlog changes. Also record a lesson when a material result arrives.

Use a stable cadence/period key to prevent duplicate reviews. Quiet when unchanged; notify only a meaningful new decision, material failure or material result. Do not repeat approval requests for valid exact approvals. Preserve the bounded Local tests and mandatory experiment reviews until native completion or unresolved work is verified. Expired schedules with outstanding work transfer that work to the shared backlog before retirement.

## Remote execution and rollout

The dashboard is private. Verified Access service identities have explicit read, prepare, reconcile, contribute or coordinate capabilities. Owner browser sessions may last one month. Machine credentials are stored per executor in its secret facility; never in prompts, source control, logs or review packets.

The cloud run must receive this versioned guide through GET /api/operating-guide and existing authorization references; it cannot depend on a Mac path or chat memory. Desktop hourly/daily schedules still require the Mac until cloud account eligibility, connected tools and an actual scheduled Mac-offline run are verified. Browser-only sources record requiresMac and their last successful check. Continue cloud-accessible checks while those sources are unavailable.

No cloud cutover is complete merely because an endpoint is reachable. Retain the local schedule until the cloud schedule demonstrates equivalent context, permissions, source coverage, idempotence and quiet notification behavior. Then disable duplicate schedules. Maintain a rollback deployment and use additive migrations only in dashboard D1.
