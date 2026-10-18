# JobHackAI business dashboard

Private Cloudflare Worker for `dashboard.jobhackai.io`, protected by owner-only Cloudflare Access.

## Sources and refresh

- Payment and user numbers are read from production D1. User records do not mean paying customers. Owner-entered monthly costs live in separate dashboard D1; income is an estimate, not reconciled accounting.
- Campaign cards use saved records. **Approve this draft** records an owner decision; sending or scheduling remains a separate verified action.
- Cards name the real channel (Email, LinkedIn, Pinterest, Facebook, Instagram, X, Nextdoor or Blog). Filters count saved cards, including batch records; they are not message or impression totals. A zero means no saved records for that platform, not proof of no activity.
- Drafts on hold appear under **Being prepared**, separately from **Needs your approval**. Approved drafts, scheduled posts and completed activity each have their own section. Held drafts cannot be approved. Every draft should link to its exact source and describe the missing checks in `next_action`.
- New drafts and Page/chat updates do **not** sync automatically. Reconcile missing drafts from the saved source records into dashboard D1, preserving existing decisions and send history. A broad group approval must not be inherited by a later replacement draft. If saved source status conflicts with a dashboard decision, preserve the decision evidence and flag the mismatch for exact-copy review.
- Tracked Gmail conversations come from a standalone Google Apps Script. See [installation and operating instructions](google-apps-script/README.md). The last non-draft message determines whether a conversation needs review or is waiting for its recipient. Only minimal metadata is stored; Gmail access stays with Google.
- Customer requests rank first, inbound prospects second, campaign decisions third. Selected conversations default to prospect; explicitly recorded customer classifications are preserved by sync.
- Page load, return to the tab, the visible one-minute interval and Refresh reload board records. Google independently checks the label approximately every five minutes. The UI displays the actual last successful Gmail scan and warns after 15 minutes without success. Refresh cannot reset Gmail freshness.
- Gmail sync does not send mail or alter approvals. Other native platforms and GA4 are not automatically connected.

## Build and validation

```sh
npm ci
npm run build
npm test
```

Build produces ignored `worker.bundle.js` (dashboard) and `gmail-ingest.bundle.js` (signed ingestion). Tests cover real SQLite migrations and atomic snapshots, Apps Script signing, owner authorization, approval isolation, freshness, failure preservation and email status transitions. Node 22 or newer is required for SQLite tests.

## Deployment and migration

Promote reviewed commits through `dev0`, `develop`, and `main`, passing dashboard CI at each stage. These standalone Workers require explicit deployment after promotion; site Pages deployment does not deploy them. Annotate Cloudflare versions with the exact source commit. Cloudflare's deployment/version API is the current release record.

Fresh databases use `schema.sql`. Existing databases need `001-priority.sql` if not already applied, then `002-gmail-sync.sql` once. Seeds preserve existing campaign decisions. Real contact records, manual-to-Gmail mappings, label IDs and secrets stay in private runtime configuration or D1, outside this public repository.

The dashboard reads the production ledger and uses dashboard D1 for costs, approvals and synced email metadata. Ingestion has only dashboard D1, accepts signed bounded snapshots, and exposes no data-reading interface. The original dashboard Access policy and disabled workers.dev/preview routes remain in place.
