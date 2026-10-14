# Tracking audit — October 13, 2026

## Scope and findings

Public HTTP audit covered 150 input URLs across marketing and the app, including aliases; these are not 150 distinct pages. All 104 marketing sitemap URLs returned successfully and included the shared consent loader. HTTP requests did not execute analytics. Nineteen distinct app HTML pages omitted the shared consent owner, including help, privacy, terms, the error page, older onboarding and exposed mockup pages. Two production-blocked voice diagnostics remain intentionally excluded.

Restore the existing consent loader and authoritative Firebase auth readiness on those nineteen pages. Legacy pages without the main stylesheet receive only isolated consent styles, generated from the canonical stylesheet; their layout is preserved. One source-coverage test now checks every root HTML page and is wired into CI.

Local listing-request success used an outdated market and omitted tracking version. Align it with the current directory events (`greater_cincinnati_tri_state`, version `2`). Preserve consent, deduplication, save semantics and absence of submitted fields or identifiers in analytics.

## Live GA4 configuration inspected

Production property 523348532, stream 13491084245, measurement ID G-SQYSWPFM5X. Stream receiving traffic; enhanced measurement enabled. Cross-domain host matching tightened to exact jobhackai.io and app.jobhackai.io. Existing exact Stripe checkout/billing unwanted-referral exclusions remain. Internal Traffic and JobHackAI staff validation exclusion filters are Active. Email redaction is active.

Existing source retains safe first/last campaign touch across the marketing/app cookie domain, consent-controlled page views, signup, checkout context, and Local category/listing/filter/provider-contact events. Existing code tests check no duplicate page view, no analytics without consent, safe campaign fields, signup deduplication and collected-payment attribution. Provider contact clicks are intentions, not bookings.

Production analytics_delivery aggregate read returned no rows at audit time. This does not establish a broken pipeline or zero historical payments; no current eligible outbox event could be reconciled to a GA purchase. No live payment, refund, fake listing request or provider contact click was performed for this audit.

## Validation

275 focused tests passed; app production build and marketing build (104 pages plus Markdown) passed; shared assets synchronized; git diff whitespace check passed. Deployment and actual event receipt must be verified separately from these build results.

## Measurement boundaries

Consent refusals, blocking software, missing/stripped tags, private shares and unreported AI referrals prevent complete person-level attribution. Keep unknown/direct traffic visible instead of assigning a guessed campaign. Search Console impressions/clicks and crawler requests measure different activity from consented GA sessions. Shared bio links identify a platform/placement, not each individual post. Never add acquisition tags to internal navigation. Staff validation uses jha_staff_test=1 and is excluded by the existing active developer-traffic filter.

For Local reporting use distinct directory sessions and distinct sessions with directory_contact_click, filtered by business_line/category/version and campaign/content where available. Retain provider IDs to identify the destination business, but do not collect customer form content or contact details. Charging providers for proven outcomes still requires confirmed outcomes beyond an outbound click.
