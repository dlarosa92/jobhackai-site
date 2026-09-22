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
