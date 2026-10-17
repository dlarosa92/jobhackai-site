# JobHackAI business dashboard

Private Cloudflare Worker for `dashboard.jobhackai.io`. The selected design is **Everything in motion**.

## Current sources

- On each page load or Refresh, the Worker queries the production D1 user and payment/refund ledgers read-only. It never treats D1 user records as paying customers.
- The action board is read from the dashboard's own D1 `campaign_items` table on every page load, Refresh, return to the tab, and ten-minute visible interval. The initial campaign records reflect the October 16 outreach sends and the November 9, 10, and 12 social schedule verified in the native platforms. Private customer and prospect records are added directly to dashboard D1, not committed to this public repository. The [JobHackAI draft approvals](https://chatgpt.com/space/page_fed12c661ba88191b522b9dad45a115b) Page remains the detailed campaign review record.
- Priority is explicit: a current customer request is first, an inbound prospect or partner reply is second, and campaign approvals are third. Direct-contact cards have a stronger color, source link, evidence, and plain-language next action. They appear before the business metrics on mobile. A prospect must not be labelled as a paying customer. Refresh does not discover new email; a verified inbox reply must be added to this database to appear on the board. A reply or completed action must likewise be verified and recorded here.
- A pending **campaign** card's **Record approval** button writes an owner decision to D1. Direct-contact cards never show this button; the source email must be answered in Gmail. Approval does not send outreach or schedule a post. After native execution is verified, an operator must update the D1 record with the outcome and evidence. Marblism, Gmail, Meta, X, LinkedIn, and ChatGPT Pages do not automatically sync into this dashboard.
- The monthly income goal is $3,000 **available to pay the owner after business costs**. The dashboard stores one manually entered total of business costs per month in its own D1 database. It does not calculate an income estimate until the owner marks the total complete. Even then, the result is an estimate based on the D1 ledger and entered costs, not a reconciled accounting figure.
- GA4 traffic is not connected. The page links to Analytics and labels traffic unavailable.

## Build and validation

```sh
npm run build
npm test
```

## Cloudflare state

The separate `jobhackai-business-dashboard` D1 database and `monthly_costs` table exist. The production D1 database is only read by this app.

The Worker is deployed at https://dashboard.jobhackai.io/. Cloudflare Access permits only `sebastian.larosa@jobhackai.io` and uses a 24-hour session. Both workers.dev and preview URLs are disabled. Runtime authorization accepts the exact Access application identity or cryptographically verifies an RS256 Access JWT against the team issuer, application audience, expiry and owner email.

Current Worker version, deployed October 17, 2026: `8a7f29af-ae3d-4270-ab35-dd809c58ce34`. Previous version for rollback: `5f1fcccb-69a9-4173-85f2-98f5a7879d62`. Access app ID: `0df868fc-81eb-4caf-b431-98b659977aea`. Custom domain ID: `684fd452a801c7b4b10b9edeb788549beea36561`.

Verified October 17, 2026: Cloudflare reports the new version at 100% deployment, and D1 contains one pending review, three scheduled posts, and five sent outreach groups. Eleven local tests pass, including owner restrictions, cross-origin rejection, approval persistence, and cache busting. A phone-sized local browser check confirmed campaign cards render, Refresh updates both check times, and an approval remains after Refresh. An authenticated production browser check is still needed because this session has no Cloudflare Access login for the owner's mobile session.

Both Cloudflare numbers and campaign records refresh on page load, when the page becomes visible, every ten minutes while visible, and with Refresh. The two sources show independent checked times and failure messages. GA4 is not connected.

`schema.sql` creates the action table. Existing databases need `migrations/001-priority.sql` once before deploying this version; it was applied to the production dashboard D1 on October 17, 2026. `seed-campaigns.sql` inserts initial records without overwriting later decisions. Keep the board current after verified customer/prospect replies, sends, schedules, bounces, or other native changes. The evidence text on each card distinguishes those native checks from the time the dashboard database was read.
