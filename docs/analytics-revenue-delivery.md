# Collected revenue delivery to Analytics

The Stripe ledger is the money source. Google Analytics is a consented marketing reporting destination, not the accounting ledger. HTTP acceptance does not prove Google processed an event.

## Current scope

The worker supports QA Sandbox delivery to the verified test stream `G-VH888WWY3M`. Delivery defaults to disabled. Development only runs retention; the browser has no development Analytics destination. There is deliberately no production worker environment in this change. Production release remains held.

Migration 027 must precede the enriched Stripe webhook. It adds a verified tax breakdown and a consent-owned D1 outbox. A five-minute schedule scans recently collected money and exact checkout attribution links. It sends at most five events per invocation, validates each with Google's strict debug endpoint, then rechecks consent and payment state before collection. It does not require a Stripe secret or expose an HTTP trigger.

`purchase` uses the captured charge ID as transaction ID. Value is actual paid USD service revenue excluding tax, with a generic, accurately named subscription or one-time service item. Zero charges, unknown tax breakdown, balances, partial captures, shipping and unsupported currencies are not guessed. Tax-free partial refunds send the exact refunded value. A full taxed refund uses the original value/tax split. Taxed partial refunds require an explicit allocation before delivery. Refund items are omitted because money refunds do not establish item quantities.

Only actual saved GA client IDs are used. A session ID is included for a purchase only within 24 hours of that session beginning. Renewals retain the consented checkout's custom first/last campaign fields while eligible; this is not a guarantee of Google's native channel/session attribution. No fabricated engagement duration or browser ID is sent.

Context and its joins/outbox expire after 90 days. Campaign touches expire by their own timestamp, independently of the later checkout. Withdrawal erases context through the consent API and cascades its marketing links. Financial payments, refunds and their non-personal tax breakdown remain for reconciliation.

## Delivery states and review

- `pending`: awaiting delivery or a safe debug-validation retry. Retries are bounded to 12 attempts and the original 72-hour event timestamp window.
- `validating`: a two-minute lease. An abandoned validation can safely retry because the debug endpoint does not collect.
- `sending`: lease acquired before the collection request. An abandoned send becomes `uncertain`.
- `accepted_unverified`: Google returned 2xx. A receipt still needs to be observed in the intended property's DebugView/Realtime and the revenue report.
- `uncertain`: collection timeout/5xx/crash, or a refund reversed after delivery. Do not blindly replay; a partial refund may have already been counted. Reconcile against actual Google receipt evidence first.
- `rejected`: explicit collection 4xx or exhausted validation attempts.
- `ineligible`: missing browser ID, incomplete financial breakdown, changed consent/context, or unsupported money allocation. It is intentionally visible.
- `expired`: original timestamp no longer eligible. Never rewrite the timestamp to today to force acceptance.

`verified_at` is reserved for actual observed receipt evidence, never set by the worker. Logs contain aggregate state counts and sanitized error categories only, with no payload, email, browser IDs or secret-bearing URLs.

## QA rollout and receipt check

1. Run billing/consent/worker tests, generated-type validation and Wrangler dry run. Apply migration 027 to development and QA, then deploy the exact reviewed webhook revision.
2. Deploy the worker with delivery disabled. Have the owner enter the test stream's Measurement Protocol API secret using `wrangler secret put GA4_API_SECRET --env qa` or the Cloudflare secret form. Never paste it into chat or commit it.
3. Verify the stream and binding, then set QA delivery enabled. Keep development delivery disabled. Its schedule may still prune expired development context.
4. Complete a new tagged Sandbox checkout with explicit Analytics consent and real browser IDs. Earlier successful webhook events are idempotent and are not automatically reprocessed to enrich their old tax breakdown. Use a new test transaction for delivery verification rather than forging a Stripe event.
5. Observe the exact purchase transaction in the test property's DebugView, then verify a partial refund and net revenue in the appropriate report. Record the observed transaction/event and evidence before setting `verified_at`. Do not treat the worker's 204 as receipt.
6. Reject Analytics in the same browser and confirm no later campaign link/delivery survives. Keep the financial totals. Verify no QA traffic or money appears in the production property.

Use read-only aggregate queries first:

```sql
SELECT event_name,state,last_reason,COUNT(*) AS events FROM analytics_delivery GROUP BY event_name,state,last_reason;
SELECT environment,currency,gross_captured,refunded,net_collected FROM stripe_collected_payment_totals;
```

Do not reset `uncertain` or `accepted_unverified` rows merely because a report is delayed. Do not erase financial ledgers to make test data disappear. Disabling delivery stops new sends while allowing retention to continue.

## Primary references

- [Google event requirements](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference/events)
- [Measurement Protocol validation](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events)
- [Stripe invoice fields](https://docs.stripe.com/api/invoices/object)
