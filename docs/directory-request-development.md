# Directory intake development task

Owner authorized September 21, 2026 in the delegated voice handoff. Active bounded
queue item: replace Get listed mailto-only intake with a private on-site form.
Base: current origin/dev0 6f2b756. Isolated checkout; voice/QA changes preserved.
QA promotion, production, indexing, public marketing and outreach remain held.

## Scope and operation

Five required fields: business name, public website, service area, service details,
contact email. No account, phone, automatic listing or submitter email. A separate
D1 `directory_requests` table holds editorial status and timestamps. The existing
listings remain static and reviewed. The form confirms durable storage only.

The API is explicitly dev-only (`ENVIRONMENT=dev`, canonical FRONTEND_URL). It
accepts only dev.jobhackai.io and the canonical dev0 marketing Pages alias.
No wildcard preview origins. Deploy migration030 only to the verified dev DB:
`c5c0eee5-a223-4ea2-974e-f4aee5a28bab` in account
`fabf4409ef32f8c64354a1a099bef2a2`. Do not migrate QA or production.

Abuse controls: 12KB streaming body limit, server field validation, honeypot,
explicit origins/JSON, atomic admission limits (5/IP/hour, 3/contact/day and
50 total/day). Raw IP is not stored. The per-day IP digest incorporates the
existing private admin secret. Identical normalized payloads and submission keys
are unique; retries and concurrent duplicates do not create extra records.

Notifications use the existing Resend secret and noreply sender, fixed destination
support@jobhackai.io, with a DEV TEST subject. All submitted content is untrusted.
No customer or prospect mail is sent. `accepted` means the provider accepted the
message, not inbox delivery. Requests remain saved on every notification failure.
A per-row lease, persisted attempts/backoff and stable provider idempotency key
protect retries. Automatic-on-submission retry and operator recovery both use the
same immutable fields/key. Maximum five attempts, within23h of the first attempt;
expired/definitively rejected deliveries need review, never a blind late retry.
Keep this renderer unchanged for pending rows if a later version changes the mail.

## Private recovery and review

No public list/read endpoint. Review requests with authorized D1 queries. Never
put contact details, submitted content, admin keys or provider receipts in public
logs/Analytics. `directory_request_saved` is consent-gated, carries category and
market only, and is not a business-interest inbox receipt or a sale.

`GET /api/admin/directory-notifications` returns status counts.
`POST /api/admin/directory-notifications` attempts up to five pending notifications
subject to lease, attempts, backoff and provider window. Both require the existing
secret in `X-Admin-Key` (not a Firebase Bearer token). Supply it privately from an
approved secret source; never paste into chat or browser code. This task does not
install a new cron or claim unattended inbox processing. A submission retry can
also recover its own due notification without adding a new request. Failed and
exhausted rows require operator review; no customer should resubmit to recover mail.

For a stuck sending lease after five attempts, or ambiguous outcome past23h,
reconcile provider receipt before any deliberate resend. Never simply reset a
counter/timestamp. Update review_status/updated_at privately after editorial review;
no status change publishes a listing. Review and remove unnecessary personal
intake details during pilot closeout; do not export them to the scorecard.

## Sign-off checklist

- On the dev link, use synthetic business details and an owner-controlled email.
- Submit without a phone/account; verify the saved reference and one private row.
- Check support inbox for the matching DEV TEST reference.
- Retry unchanged details: one request, no duplicate notification.
- Check narrow mobile layout, keyboard order, required-field/error states.
- Review the exact candidate before authorizing QA promotion.

Implementation/testing/deployment evidence will be appended after verification.

## Candidate evidence

17 focused Node/SQLite/client/consent tests and two native Workers/D1 tests pass.
Native tests cover concurrent admissions, the real Request redirect mode,
unauthenticated admin rejection, and due notification recovery with identical
payload. Full app Pages Functions bundle compiles with installed app dependencies.
Shared marketing assets match. At375px, browser inspection found no horizontal
overflow and all five fields remained usable; empty submit focused Business name,
Tab moved to Website, and labels/required constraints were exposed in the DOM.
No microphone or real provider call was used for these checks.
