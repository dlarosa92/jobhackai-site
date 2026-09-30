# Consent-owned checkout attribution

Tagged external visits may preserve first and last campaign touches for 90 days after the visitor grants Analytics consent. Accepted tags are `utm_source`, `utm_medium`, `utm_campaign`, optional `utm_content` (asset), and `utm_id`. Values must be controlled slugs: letters, digits, underscore, period, hyphen, at most 100 characters. Missing/invalid tags stay unattributed. Never put names, emails, tokens, or other personal data in campaign tags.

Production marketing and app hosts share the production campaign cookie. QA uses its own host-only campaign cookie and Analytics destination. Internal navigation does not replace the external campaign. The server tolerates up to five minutes of device clock skew and clamps accepted future timestamps to receipt time. Each touch expires independently; an older first touch can expire while a newer last touch remains. The first touch is the earliest still-retained known touch, not a lifetime acquisition claim.

Checkout entry points in pricing, sign-in, email verification, and the legacy subscription wrapper request optional context. Account consent is refreshed before a cached grant is used; unsaved user decisions are retried. Only real GA client/session values returned by the tag are included, with bounded waits. Missing or blocked GA identifiers are left absent. Stripe requests and idempotency keys do not include analytics data.

The server stores context only for an open Stripe Checkout Session owned by the resolved Stripe customer, with authenticated account consent persisted in D1. Same-browser anonymous rejection or malformed consent vetoes saving. Context is immutable per Checkout Session, and a failure to store analytics never prevents payment. A completed or expired session cannot acquire new marketing attribution through a retry.

Withdrawal immediately clears the browser campaign cookie and removes saved contexts for the verified account and/or browser. Financial charge/refund records are separate and are preserved. Failed consent synchronization remains pending across reloads and retries on reconnect; the page displays the pending state. Account-wide withdrawal is rechecked at checkout so a cached local grant does not silently override it.

## Deployment and evidence

Apply `app/db/migrations/025_checkout_attribution.sql` to the correct environment **before** deploying these consent and checkout handlers. Do not deploy root marketing handlers before the corresponding production schema is ready. Production deployment remains held.

Local tests cover actual SQLite insertion, immutable retries, verified identity, absent/invalid grants, anonymous rejection, blocked GA, expiry, withdrawal, browser navigation and consent races. Candidate app and Functions builds are required. Live tagged signup/checkout/D1 evidence is still required after candidate deployment.

## Collected payments and campaigns

Apply migration `026_payment_campaign_links.sql` after 024 and 025 and before the new webhook handler. Missing migration fails the entire financial webhook batch and leaves the event retryable. A charge links only through its exact Checkout Session, or through the exact subscription recorded by the verified checkout callback, with matching customer and environment. Ambiguous contexts remain unattributed. The checkout context must predate the charge and still be eligible under both account and browser consent. Checkout and charge callbacks may arrive in either order; subsequent subscription payments follow the same subscription context until expiry or withdrawal.

`stripe_campaign_revenue` provides one row per captured charge, including unattributed charges, with first and last touches and successful refunds subtracted once. Amounts are integer currency minor units, before fees, taxes, and disputes. A consented checkout can still have absent campaign tags; do not label it as a known marketing channel. Withdrawal deletes marketing links through foreign-key cascades while keeping financial records. Reports also recheck consent and expiry. Regrant purges stale context before replacing a previous rejection, so failed cleanup cannot revive old marketing history.

## Remaining integration

The database join does not deliver GA purchases/refunds or verify GA receipt. A consent-checked durable delivery queue and an actual retention cleanup job remain required before claiming end-to-end marketing revenue attribution. `expires_at` is currently an eligibility boundary, not proof that stored rows have been deleted on schedule. Missing attribution must remain visible instead of being assigned to a guessed channel.
