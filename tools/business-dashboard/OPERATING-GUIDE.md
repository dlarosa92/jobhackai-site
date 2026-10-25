# JobHackAI operating guide

Version: 2026-10-25. This guide supersedes older board organization, workload caps, mandatory external-app draft-review instructions and chat-only claims of completed scheduled work. It does not revoke recorded individual approvals or grant external execution.

## Mission and ownership

Grow the software product toward 250 users and verified revenue. User records are not paying customers. Preserve approved Local commitments; evaluate Local outcomes separately. Do not invent an income target.

One shared backlog, one accountable department per item, supporting contributors and explicit dependencies. Customer-impacting failures and commitments come first, followed by evidence-backed software growth. The coordinator sets the cross-department order. Significant unresolved tradeoffs become individual owner decisions. Do not manufacture decisions to keep the board busy.

- Marketing owns content, distribution and lessons from results. Use existing Marblism Sonny and Penny workflows for social and article preparation.
- Sales & Outreach owns researched prospects, partners and individual conversations. Use existing Marblism Stan workflows and the exact outreach gate.
- Product & Technology owns reliability, usability, features, measurement and dashboard defects. Use repository issues, PRs, tests, deployment receipts and monitoring.

Reuse existing employees, tasks and campaigns. The hourly research workflow owns Marblism employee requests; daily coordination must not send duplicate requests. An already-running employee task stays running. Five-per-day, five-item queue, fifteen-minute research and two-hour weekly preparation ceilings were removed by the owner and must not be restored. A short dashboard display is not a workload cap.

## Evidence and review

Read source metadata first; retrieve full changed content only when needed. Prefer APIs, MCP and plugins, then supported native browser access. Stable item IDs and version-conditional writes are mandatory. Keep people and posts separate when decisions are individual.

A catalog entry proves presence, not unchanged full content. Renew a packet's verification only after comparing an authoritative native revision/update stamp with the saved revision, or rereading its full content. Keep `verifiedBy` concise (at most 200 characters); put check details in evidence instead of repeatedly appending them to the verifier name.

Every review-ready draft needs complete exact text and any HTML, recipient or destination account, media URLs with immutable revision/digest, all final links, proposed timing, source revision, checked-at time and independent verification evidence. Unknown, incomplete, stale or conflicting snapshots stay in preparation. Do not copy summaries into the complete-copy field. Clicking a card should reveal the complete saved review snapshot inside the dashboard; native source links are secondary.

Missing copy verification, claim sources, media selection or proposed timing are ordinary unfinished preparation, not external blockers. Keep those cards `in_progress` or `up_next`, clear their blocker field and name the next concrete preparation action. Reserve `blocked` for a verified obstacle that cannot be resolved within the authorized workflow. Do not ask Sebastian to review an incomplete native-only packet; finish and import its review snapshot first. Preserve historical proposals and decisions when updating current next actions.

Reconciliation owns native source status. Department owners own recommendations. The coordinator owns cross-department rank. Sebastian owns approval, request-changes, decline and separate release decisions. Do not mark a draft sent, approval scheduled, or schedule published. Changed copy, media, destination or timing requires a fresh exact decision. Review history remains immutable. A source check failure retains previous evidence and must be reported as unavailable or incomplete, never as zero activity.

Received conversations are reviewed individually. Mark reviewed is tied to the latest native message ID and does not modify Gmail. A new message reopens the card. Review the full conversation before preparing a reply; the metadata preview is not a complete conversation.

## Outreach and permission authority

Use Add a prepared email for review. Stan prepares; Codex independently verifies first-party published email evidence, a current business-fit fact and stable message reference. Sebastian approves the complete exact recipient/copy, then separately requests Send approved email. Generic approvals and historical batch records cannot authorize a replacement message. Never bypass a held gate in Gmail or Marblism.

Prospect introductions and cold follow-ups default to plain text with visible URLs and a plain signature/footer. Plain founder voice describes the writing; it is not permission for HTML, styled signatures, hidden-link text, CSS or templates. Keep campaign tracking in the actual URL; use an existing verified branded short URL when available. Never invent a short URL or remove tracking to simplify the draft. Stan supplies one plain-text body; Codex checks the format and actual links before submission. Do not copy a supplied HTML variant into the send packet automatically.

An HTML exception requires a concrete reason in formatRequest.reason and Sebastian’s owner-only format decision on the exact revision. An agent cannot approve its own exception. The gate holds HTML at approval, queue and claim until that decision exists; the Google sender requires the matching server permit. A changed body, destination, HTML or reason requires a new format decision. Exact copy approval and separate release are still required. Preserve sent versions as history and existing unchanged plain-text approval hashes. Keep historical HTML outside the current active draft; do not silently strip formatting at send time.

Reconcile native Sent, replies, drafts and delivery reports across all folders before a possible repeat. Verify domain/MX status and resolve every MX target using the current routing-preflight helper. Nonzero, stale, conflicting or incomplete checks are holds. Routing presence proves neither mailbox existence nor inbox delivery. Bounce, opt-out and uncertain-attempt holds remain until individually reviewed; never automatically retry. One cold follow-up requires its exact separately approved revision, original thread, five complete business days and no reply, draft, failure or prior follow-up. Preserve any narrower weekday or finite-recipient authorization.

Sender installation instructions distinguish an initial read-only installation from a separately authorized activation. Do not treat old 'keep disabled' prose as a command to revoke a later authorized activation, or treat an enabled runtime flag as approval to send. Preserve current settings while reconciling the owner's permission receipt. No reconciliation or department-assessment run may change Gmail permissions, sender flags or release messages. Machine dashboard access cannot approve, release, change costs, administer access or write the production payment ledger.

Preserve the six October 19 sends, all other native receipts, approved revisions, bounce/opt-out restrictions and uncertain attempts. Do not retry to prove that a sync works.

## Attribution and claims

Use validated campaign tags on clickable promotional links: lowercase platform-specific utm_source, appropriate utm_medium, actual utm_campaign and distinct utm_content. Verify saved and published destinations and tag retention through signup and checkout. Shared bio links support aggregate attribution only. Separate visits, clicks, sends, contact intent, replies and verified collected purchases. Do not claim bookings or revenue without their own evidence. Marblism preparation does not authorize publication, scheduling, outreach or spending.

## Coordination and cadence

- Hourly preparation owns employee requests, requested revisions, independent checks and complete review packets. The existing research workflow alone requests work from Marblism. Finish eligible existing work before new generic draft volume. A weekend email hold applies to those messages only; assess independent Marketing, Sales and Product work.
- Hourly reconciliation inspects changes, records source freshness/failures and imports completed native work. It does not duplicate preparation's employee requests. Its first run of each Eastern day imports the production GA4 rolling 28-day report through yesterday, with explicit campaign, kit-action, staff-exclusion, attribution and purchase-reconciliation coverage. Partial coverage is labeled; unavailable access retains the last report and records a blocker. Never reuse fixed historical exploration dates as the current operating window.
- Daily coordination records three department assessments, resolves shared dependencies, sets the common priority order and prepares complete owner decisions. Reuse the existing daily decisions schedule.
- Weekly planning and retrospective run within the first daily review of the Eastern calendar week. Record what worked, failed, source evidence and resulting backlog changes. Also record a lesson when a material result arrives.

Use a stable cadence/period key to prevent duplicate reviews. Quiet when unchanged; notify only a meaningful new decision, material failure or material result. Do not repeat approval requests for valid exact approvals. Preserve the bounded Local tests and mandatory experiment reviews until native completion or unresolved work is verified. Expired schedules with outstanding work transfer that work to the shared backlog before retirement.

### Execution receipts and decision handoffs

Every scheduled pass reads the live guide, board and `/api/workflow`, then starts its `preparation`, `reconciliation` or `coordination` run through `/api/workflow/start`. The server chooses the period and records the initial versions. Resume an existing running receipt; a completed receipt makes that period idempotent. A failed or expired period remains visible until the next scheduled run. Do not claim current checks from old chat context.

Include the returned `runId` in each prepare, reconcile, source-health and coordination write. Only successful writes attributed to that active run count toward its receipt; another concurrent workflow's changes never count. Daily coordination must save its own assessment for the server-selected Eastern date. Check actual unfinished dependencies, not merely whether an item declares dependencies.

Use `/api/workflow`'s `preparationQueue` to distinguish unfinished eligible work from finished packets awaiting owner review. A full owner review queue is not a reason to stop independent preparation. Take the highest-priority eligible work from the shared board; use Marblism for copy work and complete existing drafts before commissioning duplicates. Reconciliation preserves this distinction instead of turning a generic draft description into a blocker. Coordination assesses saved progress through the backlog as well as the number of ready packets.

Owner decisions atomically create durable follow-ups assigned to the item's department. Preparation claims each follow-up with its version and active run ID, resolves the note and saves independently verified full copy, links, media and timing. A comment on approval is a requirement to assess and resolve, never automatic release permission. Preserve the decision history. Changed substantive content requires a new exact decision. Close the handoff only after its verified packet is saved, or block it with a concrete reason and a future checkpoint. Never move a deadline forward merely to hide overdue work.

Finish each run through `/api/workflow/finish` with source evidence and its actual outcome. `advanced` requires a changed saved work artifact or a completed decision handoff plus fresh checks. `checked` requires fresh source/coordination evidence. Neither `checked` nor `blocked` can close an eligible unfinished preparation backlog; record genuine external obstacles on their affected items and resolve or checkpoint open decision handoffs first. `blocked` also needs a named obstacle and a checkpoint within seven days; it remains an attention state. Finished packets awaiting review do not themselves require a globally blocked result. `failed` never counts as a completed check. A chat message, prompt update, page refresh, or unchanged status repeated from memory is not an execution receipt.

The dashboard's independent 15-minute server check records missed hourly runs after 90 minutes, expired one-hour run claims, missed daily coordination after 26 hours, and overdue decision follow-ups (initial checkpoint: two hours). These appear in “Is work moving?” even if the Mac or agent is unavailable. Reconciliation surfaces new or materially changed alerts to Sebastian; repeated unchanged alerts remain on the board. This monitor never sends mail, requests employee work, approves, publishes or alters production data.

## Remote execution and rollout

The dashboard is private. Verified Access service identities have explicit read, prepare, reconcile, contribute or coordinate capabilities. Owner browser sessions may last one month. Machine credentials are stored per executor in its secret facility; never in prompts, source control, logs or review packets.

Sebastian selected the existing Mac-based preparation, reconciliation and daily coordination schedules. Keep that path; cloud agent migration is deferred. The hosted dashboard API is available to the installed scoped local machine client. Do not confuse deferred cloud-agent access with unavailable local dashboard access. Browser-only sources record requiresMac and their last successful check. Continue independent available checks when a source fails.

The server deadline monitor is independent of the Mac; it monitors receipts and does not replace the local execution schedules. No cloud agent cutover, duplicate employee-request schedule or expanded permissions is part of this workflow. Keep private finite release authorizations in their existing records and schedule context. Maintain a rollback deployment and use additive migrations only in dashboard D1.
