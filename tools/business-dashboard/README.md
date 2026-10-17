# JobHackAI business dashboard

Private Cloudflare Worker for `dashboard.jobhackai.io`, protected by owner-only Cloudflare Access.

## Sources and refresh

- Payment and user numbers are read from production D1. User records do not mean paying customers. Owner-entered monthly costs live in separate dashboard D1; income is an estimate, not reconciled accounting.
- Campaign cards use saved records. **Record approval** records an owner decision; sending or scheduling remains a separate verified action.
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
