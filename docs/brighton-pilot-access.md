# Brighton pilot access and measurement

## Enrollment

Each participant and specialist creates and signs into their own free account at
https://app.jobhackai.io/login?plan=free. No Stripe checkout, payment card, shared
specialist login or public voucher is needed. The owner confirms the intended
account email before granting access. This confirmation is an owner attestation;
the dashboard does not claim to verify Firebase's email verification flag.

Existing backend fields already support direct complimentary credits. The new
dashboard tool wraps that operation with a dry run, atomic grant receipt and
duplicate protection. It is not a prerequisite for a separately reviewed direct
grant. Previously granted accounts must be reconciled rather than granted again.

After migration and deployment, the owner opens **Brighton pilot** in the existing
private business dashboard. Supply a stable grant reference, the account email,
role and exact access dates, then choose **Preview grant**. Verify the account and
the Eastern time preview, confirm the account belongs to the intended person,
and choose **Grant 60 complimentary credits**. Repeating the same grant does not
add credits or extend its expiry. Changing an existing grant is deliberately held
for review rather than silently replacing it.

Participants receive 30 days from the agreed pilot launch. Do not apply their
grant before that date: the existing credit mechanism makes credits usable
immediately. Future dated previews are supported, but no automatic activation is
scheduled. Specialists may start preparation earlier, with access ending on the
same participant pilot end date; their maximum preparation plus pilot window is
45 days. Staff preparation does not create or start participant grants.

The tool enrolls at most ten participants and three specialists. It only grants
to an existing free account with no subscription, paid history, remaining credit
or old credit expiry. Other accounts are held for individual reconciliation so
purchased access and earlier complimentary grants cannot be overwritten.

## What 60 means

The grant adds 60 pack credits with the selected expiry. It does not modify the
subscription, payment history, account plan or lifetime free interview. An unused
lifetime free interview remains separately available after the credits run out.
The UI explicitly displays this. This is a 60 credit allowance, not a hard total
cap of 60 interviews across every account entitlement. A later paid purchase is
also a separate right and causes the pilot balance display to require review.

The existing voice reservation transaction enforces available pack credits.
Reconnects reuse their session; provider setup failure precedes reservation;
the existing single early end grace can restore one credit. Consequently credits
used is net consumption and is not identical to completed interview count.

Sessions started with these credits retain full feedback and transcripts under
the current report rules without setting `has_ever_paid`. Normal retention still
applies. Older free session reports may unlock while credits remain and relock
when the account has no qualifying entitlement.

## Measurement

The private dashboard reads the app database, not GA4 or Stripe events. It shows
enrollment role, granted credits, net consumed and available credits, expiry,
separate lifetime free availability, retained starts, retained completions and
last retained activity. It does not expose transcripts, responses or scores.

Deleted session history is not counted as starts or completions; those figures
are explicitly labeled retained records. Deleting history does not restore the
account's pack credits. If billing, expiry or the observed balance changes after
enrollment, the remaining allowance becomes unavailable pending review rather
than presenting an invented balance. Undetectable out of band balance changes
are a limitation of reusing existing fields; operators should use the recorded
grant flow and reconcile direct adjustments. Deleted accounts also delete their
linked pilot grant through the foreign key.

## Release and operations

This branch does not enroll users, apply migrations, set flags or deploy anything.
Apply `app/db/migrations/036_pilot_credit_grants.sql` to the application database
in each validation environment before enabling `PILOT_ADMIN_ENABLED=true` on the
corresponding dashboard Worker. The feature defaults off. Keep existing Access
policies: only Sebastian's owner session can read pilot emails or apply grants.
Service identities cannot access either pilot route. Existing billing and voice
code are unchanged; no new Stripe product, coupon or webhook is introduced.

The private dashboard adds `GET /api/pilot` for reads and `POST /api/pilot` for
preview and apply. POST defaults to a dry run; only `dryRun:false` plus a matching
`expectedRevision` and `confirmAccountOwner:true` applies a grant. The apply
transaction repeats eligibility and capacity checks and stores one grant per
account. A lost response can be retried with the same reference and exact dates.
Never retry its credit update separately.

Validate with `npm test` and `npm run build` in `tools/business-dashboard`, then
exercise the owner flow on isolated development and QA data. Promote through the
repository's normal review and release path. Dashboard Workers require explicit
deployment; a Pages deployment alone does not update the dashboard.
