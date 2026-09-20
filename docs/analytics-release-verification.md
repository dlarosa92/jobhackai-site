# Analytics is a production release gate

Owner instruction, September 19, 2026: analytics must not be an afterthought. Previous configuration changes are not evidence that measurement works. Do not promote the voice beta to production until the relevant journey has been verified and remaining limitations are explicit.

## Baseline observed live September 20 UTC

- Existing Google Analytics account: Default Account for Firebase, account 366252518. Production property jobhackai-prod-510a4, property 523348532.
- Production web stream: JobHackAI Production, stream 13491084245, measurement G-SQYSWPFM5X; Google tag GT-KVN4XPBS. The displayed stream URL remains the Firebase hosting domain. That label alone does not prove collection is broken.
- Google reports no data received in the past 48 hours and tag quality Urgent. Home showed some recent events, so this is not evidence of total historic loss.
- Property change history has 47 records. June 7: page_path custom dimension and two audiences created; Internal Traffic exclusion changed from Testing to Active; key-event settings modified. No property changes shown in the initial August 20–September 19 filter. The history identifies an account, not whether a human or AI performed the work.
- Tag setting Ignore duplicate instances of on-page configuration is enabled. No settings were changed during this baseline audit.
- Cross-domain rules: jobhackai.io exactly matches; app.jobhackai.io contains. This configuration is present, but live session continuity is still unverified.
- Internal traffic rule Localhost / dev traffic marks IP ranges 127.0.0.0/8 and ::1/128 as internal. These loopback rules do not isolate development hostnames and do not establish why customer events might be missing.
- Production retention: event and user data 14 months, reset on new user activity enabled. Reporting identity Blended, with one inactive method. Left unchanged.
- Production key events: close_convert_lead, cta_click, generate_lead, manual_event_PURCHASE, purchase, qualify_lead, sign_up and trial_start. All eight show no stream data detected in the last 28 days; existing definitions are preserved pending diagnosis.
- Existing development property jobhackai-90558 (502443078) contains JobHackAI Web App stream 12184859894, G-VH888WWY3M. Enhanced measurement is off. This separate destination is used for QA; no new account/property is needed.

## Code findings to resolve or verify

- Candidate dev0 before repair: both development and production Firebase config specify G-SQYSWPFM5X; cookie-consent.js defaults every hostname to the same production ID and Clarity project.
- Production branch ed00ca6 differs: cookie-consent.js defaults to G-X48E90B00S, while production Firebase config uses G-SQYSWPFM5X. This split is a separate concrete configuration defect. The live homepage DOM references the matching main-branch script URL (v=20260506-1). Opening that live script directly in Chrome was blocked with ERR_BLOCKED_BY_CLIENT, so its fetched response body was not verified through Chrome.
- Firebase Analytics and cookie-consent.js both initialize analytics. Consolidate ownership and prove exactly one page_view per document, including consent granted late and revoked/regranted.
- The browser has a consent gate, but stripe-webhook.js sends server-side events without checking current consent. It uses a synthetic server.<uid> client ID rather than the browser client/session identifiers. This cannot be accepted as a proven campaign revenue join.
- Checkout currently stores identity and plan metadata but no verified attribution context. No first/last campaign persistence found in the inspected implementation.
- The webhook handles initial paid checkout and trial-to-paid events; recurring paid invoices and refunds are not a complete net-revenue ledger. A subscription status change alone is not evidence of payment collection.
- Existing tests prove billing-side idempotency but do not prove GA4 received or correctly attributed the events. Existing documentation has pending DebugView and cross-domain acceptance boxes; keep them pending until observed.

## Required evidence

1. Record current domains, internal traffic rules, filters, events/key events, retention and reporting identity before changing anything. Preserve existing history.
2. Keep QA, development, previews and local tests out of production GA4 and Clarity; validate in a separate existing test property or explicitly configured test destination.
3. With consent denied, send no analytics. Grant and revoke consent and verify subsequent behavior. Never send email, resume text, interview transcripts, employer-sensitive content or auth action tokens to analytics.
4. Follow a campaign-tagged external visit to marketing, app, signup, first interview, completion, paywall and checkout. Verify one session and correct source/campaign/content; internal links must not overwrite the acquisition source.
5. Verify a Stripe test purchase, webhook replay and a repeat pack purchase. Real collected amounts and transaction IDs must reconcile; no duplicate purchase.
6. Verify refund and renewal accounting before reporting net or lifetime campaign revenue. Report unavailable or unattributed explicitly rather than guessing.
7. Confirm the same event contract in GA4 DebugView/Realtime and later processed reports. Record dates, candidate/deployed commits and test transaction identifiers without secrets or customer details.
8. Make production release conditional on these checks alongside live voice acceptance. Keep the rollout and rollback steps together with the evidence.

## First repair: browser collection (not full attribution acceptance)

The code removes the second Firebase Analytics initializer; consent owns the only loader. QA explicitly uses the verified development stream with DebugView enabled. Development, previews and localhost default off; an explicit separate test ID is supported, while copying the production ID into a nonproduction override is blocked. Production still uses its existing property and history.

The browser suppresses duplicate manual/fallback page views, sets Google's collection-disable flag when consent is withdrawn, rejects stale server consent responses after a newer local decision, and strips noncampaign query parameters from page URL fields. Controlled UTM slugs remain available. These checks execute the real consent module with network-free browser fixtures: `npm run test:analytics` (14 passed). This is not evidence of vendor receipt or complete privacy enforcement by every third-party automatic event.

Still open: Clarity runtime consent/recording behavior (removing a script alone is not proof of teardown), automatic enhanced-measurement payload review, authenticated server consent enforcement, real browser client/session attribution at checkout, durable paid-invoice/refund accounting, live QA receipt and Stripe reconciliation. No production GA4 settings, production deployment, or production schema was changed during this audit.

Official implementation references: [Google collection-disable flag](https://developers.google.com/tag-platform/security/guides/privacy), [Measurement Protocol events and session context](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events), and [Clarity consent behavior](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2). A consent-denied Clarity mode can still involve limited tracking, so it does not by itself satisfy the no-tracking acceptance check.

## Browser receipt evidence, September 20 UTC

Using PR #864 commit af5237c's actual cookie-consent.js in an isolated localhost test page, a browser consent grant followed by one labeled `analytics_delivery_check` event was observed in Google Analytics DebugView for development property 502443078. The event detail showed `test_run=20260920_browser_01` and `page_location=http://127.0.0.1:8766/?utm_source=qa&utm_medium=verification&utm_campaign=analytics_repair_20260920`. DebugView showed one each of first_visit, session_start, page_view and analytics_delivery_check for this run (23:51 Eastern September 19). This verifies browser-to-Google delivery and preservation of the controlled campaign URL. It does not prove processed campaign attribution, cross-domain continuity, signup, purchase, refund, renewal, or production delivery. No synthetic signup/purchase was emitted.

The first local browser attempt revealed a command-queue compatibility issue in the proposed change; it was corrected to Google's standard Arguments command format, added to the regression checks, and browser receipt was then verified. This is why local unit checks alone do not close this release gate.
