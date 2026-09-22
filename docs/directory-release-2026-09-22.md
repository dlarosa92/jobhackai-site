# Directory-only release, September 22

Owner explicitly authorized directory-only development, QA and production rollout,
necessary directory schema/configuration and verified launch. Voice production,
public social copy, prospect contact and purchases remain held. This overrides
older directory publication holds only; no automatic listing approval.

## Isolated candidate and staging method

Production base: ed00ca62d1bed102747085d736dad931e0a651c3. Never merge all of dev0
or develop into main for this release. Production career homepage, pricing,
authentication, billing and voice retain their base behavior; homepage receives
one Local directory footer link. New consent assets load only on directory pages.

Promote the exact directory API modules and migration030 through dev0 and develop,
without changing existing voice controls. Deploy the main-based marketing candidate
at directory-dev and directory-qa preview aliases on the existing marketing Pages
project. These explicit aliases call the corresponding canonical app APIs; all
other arbitrary previews fail closed. Record source hashes, staging app deployment
SHAs and preview SHAs. Compile the full main-based app candidate separately and
verify its only runtime changes are directory endpoints before main release.
This exception preserves ongoing voice QA and avoids provisioning or copying keys.

## Database and delivery

Use only migration030, explicitly targeted to each environment's existing D1 DB.
It adds one private directory_requests table and two indexes; no existing tables
or records change. Verify schema before and after. Existing RESEND_API_KEY and
ADMIN_API_KEY remain encrypted and unchanged. DEV retry payloads remain immutable;
QA and production notification keys and labels have separate namespaces.

Storage receipt is not notification receipt. Confirm synthetic request and duplicate
behavior in D1, then actual support inbox receipt. Provider accepted/delivered status
is recorded separately. Never publish synthetic listings or contact a business.

Recovery uses the existing private admin route, lease, five-attempt bound and23h
provider idempotency window. Inspect counts and due rows at scheduled checks; escalate
needs_review rather than resetting ambiguous receipts. No automatic listing approval.

## Rollback

Record both current production Pages deployment IDs before deployment. If smoke
checks fail, restore previous marketing and app deployments independently. Keep
additive migration030 and saved private requests; do not drop records during rollback.
This closes the new UI/API while retaining review/recovery evidence. No billing,
voice or unrelated migrations/configuration changes are part of this release.

## Remaining release gates

- Current exact API and static hashes on development and QA; CI and runtime bundle.
- Mobile, keyboard, filter, navigation and required-field/duplicate/error behavior.
- Synthetic durable intake, one notification, actual support inbox receipt.
- Consent rejection/grant/withdrawal, real GA receipt and session-based reporting.
- Production indexing only, canonical URLs, sitemap, modest discovery link.
- Exact main diff reviewed; production configuration/bindings and rollback recorded.
- Public smoke verified, then actual launch timestamp and day28 date recorded.
- Existing automations updated once for weekly/day28 reviews; no duplicate schedule.

Launch timestamp and review date: unset. Social package remains draft-only.

## Staging evidence, September 22 (UTC)

- Development API: PR946, canonical dd87e3f5c82ef778354729e37dc95da0f93c12fc, deployed12:50:34.
- QA API: PR948, canonical722df875a4b91555037b8c042f9730b02b455816, deployed12:55:26.
- All three directory runtime modules have identical SHA256 hashes across staging
  promotion branches and this production-base candidate. No voice control changed.
- Dedicated marketing dev/QA aliases return200 and noindex,nofollow. QA static
  candidate cf68e27; dev static1c4a89c has identical runtime assets (later CI-only edit).
- Browser submissions saved one private row in each environment. Browser duplicate
  submissions returned the original references: one row and one notification attempt
  per environment. Actual DEV TEST and QA TEST notifications visibly arrived in the
  company support inbox. Provider acceptance and inbox receipt independently checked.
- QA rejects an unlisted origin403, empty payload400, and unauthenticated admin401;
  allowed-origin preflight204. Local tests cover payload, rate, concurrency and recovery.
-375px form visually checked; required-field submit focuses business name; keyboard
  Tab reaches website. Hub boat filter returns one provider; reset restores six.
- QA consent: no Google/Clarity script before choice or after reject; grant loads only
  G-VH888WWY3M. Withdrawal persists across navigation with no Analytics script loaded.
  Preview consent is browser-local with a visible pending server-sync notice because
  these isolated static previews have no consent API. Production uses its existing API.
- Google DebugView at12:58 shows actual QA page_view3, directory_listing_view1,
  directory_contact_click1, directory_request_saved1 and session_start1. No request
  fields or request reference is included in our Analytics event payloads.
- QA exploration created: ADdor0wqSUGAOFCbKLBuuA, property502443078. Session-scope
  directory URL segment and same segment plus exact directory_contact_click condition,
  with Sessions metric. Today's processed table is not populated yet; this is pending
  processing, not zero demand or a verified conversion rate.
- Existing production stream13491084245/property523348532 confirmed G-SQYSWPFM5X.
  Existing enhanced measurement remains unchanged. Root consent API responds200 with
  correct allowed origin; www redirects301 to canonical root.
-77 focused tests, full production-base app build and Functions bundle passed;
  applicable PR947 CI passed. Deployed-base E2E was skipped, not treated as candidate proof.
- Rollback baselines: marketing dfdce215-701c-45fe-94b9-74a386431d16; app
  f40d2415-4946-414f-8e00-099e67b80a85, both ed00ca62d1bed102747085d736dad931e0a651c3.
