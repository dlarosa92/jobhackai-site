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

Snapshot fields: complete:true, conflict:false, sourceRevision, checkedAt, verifiedBy, text, html, destination, subject, timing, media (`{url,digest,alt}`), links (complete HTTPS URLs including tags), evidence (`{id,url,fact}`). Empty media/links arrays must be explicit. At least one evidence record is required. Snapshot content is immutable; changed substantive content produces a new digest and decision requirement. Freshness is separate from content identity. Approval requires a draft, ready preparation, current source health, checks within 24 hours and completed dependencies. Native source feeds retain authority over Gmail, directory and outreach status.

Canonical source references for existing records: campaign/campaign_items.id, gmail/native thread ID, outreach/outreach_messages.id, directory/directory-prefixed ID. A unique `(source,source_id)` constraint prevents duplicate source cards. The work-item projection replaces its matching old card. Do not change a work item's source identity to represent another person/post. Work can be completed or declined without deleting history.

Outreach retains `/api/outreach/prepare`, `/approve`, `/send`, `/cancel`; only prepare is available to machines with that capability. Owner-only `/api/outreach/feedback` accepts id, exact revision, action changes/decline and note. Feedback withdraws current approval and holds that revision; a different prepared revision requires a new decision. The signed relay, source/routing checks, suppression and one-attempt protocol remain authoritative.

Metadata-only reconciliation retains the saved review packet and its decision when the source revision is unchanged. A different source revision without a complete replacement snapshot removes it from current review while retaining historical packets and decisions.

Operations, GitHub and analytics tasks with complete preparation satisfy dependencies only after their prerequisite chain and explicit blockers are resolved. Content preparation alone never means publication or sending.

409 means reload and reconcile; never blind-retry an obsolete version. Approval and preparation never execute publication or sending. There is no machine cost, access-admin, approval or release API.

Local executors can use `node scripts/dashboard-client.mjs get /api/work-items` or `post /api/work-items/prepare /private/path/packet.json`. It reads a mode-600 credential file at `~/.local/share/jobhackai/dashboard-access/credentials.json` (or the `JOBHACKAI_DASHBOARD_CREDENTIALS` secret-file path) containing `origin`, `clientId` and `clientSecret`. Install credentials separately through each executor's secret facility. It refuses owner routes and redirects. Monitor service-token expiry and rotate in the executor secret store; a long browser session does not renew machine credentials.
