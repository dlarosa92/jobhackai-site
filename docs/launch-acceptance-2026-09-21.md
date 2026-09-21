# Launch acceptance continuation — September 21 UTC

This record supersedes older statements that PR913 is unmerged or its Pages
bindings are waiting for deployment. It is a verification record, not production
release approval. Owner requested completion of QA and the bounded directory
experiment on September 20 Eastern; routine staging work continues.

## Deployed application

PR913 and ancestry repair PR929 merged to development; PR928 merged to QA.
PR930–933 subsequently merged to development. PR934 promoted the same fixes to
QA after all checks passed; the canonical QA deployment is verified below.

| Target | Revision | Successful canonical deployment |
| --- | --- | --- |
| Development | 398746a15c442efa3328643b2d14f73a2364508b | c794f2a3-932d-4f64-aa7f-7c8ec484c7c4 |
| QA | 3c72be5109c87b3f02dcb1799817279729f7a251 | df2feee3-e40e-40d2-98d0-04aae8ca3f1f |

QA marketing deployment1be566f3-bcee-4c40-b99c-c1cd54643b63 also succeeded
at3c72be5 on03:39UTC.

Both have the matching isolated D1 and Durable Object bindings, RPC enabled and
managed transport true. Anonymous POST to the old `/api/voice/session` returns
409 `voice_transport_updated` on both custom domains and both root Pages hosts.
The replacement `/api/voice/connection` returns401 without authentication.
These checks invoke no provider and prove neither authenticated success nor
closure of a previously issued legacy call.

## Voice runtime

Development deadline worker was enabled for controlled new-session testing at
02:52UTC, version `19da24ea-c16d-4f0b-8060-e161881bd93f`. The deploy used the same
reviewed source as origin/dev0 with only `VOICE_DEADLINES_ENABLED:true` overridden.
Dry run passed; independent deployed settings confirm true, encrypted key name
and correct development D1. QA deadline worker remains disabled pending the
development runtime test. Source defaults remain false for safe future deploys.

This staging enablement does not clear any legacy hold or claim a completed
credential drain. Old immutable issuers have the recorded Access restriction;
authenticated denial, prior credential/provider closure evidence and any
reconciliation remain open. Do not erase, relabel or release those holds based
on time elapsed or empty managed ledgers. Production acceptance still needs the
complete cutover evidence.

At 03:01:03 UTC the owner-authorized development microphone test failed before
connection. D1 records one `uncertain` provider-create attempt with
`create_unconfirmed`, no saved provider ID, and an unresolved execution token.
No new voice_session reservation was created. Do not infer rejection or closure
from the missing provider trace, elapsed time, or a generic browser alert.
No further voice start was attempted. New development arms were paused by
worker version `e5a54a56-c91d-49bc-a208-70fff9666cd0`; existing deadline alarms
remain available for handling and review. Read-only verification at 03:10 UTC
confirms both staging workers disabled, dev one unresolved call, QA zero.

The OpenAI Realtime logs page has no saved session trace for this attempt.
Cloudflare Pages exposes a prospective log stream; none was attached when the
failure happened. Exact provider response/terminal invocation evidence is not
yet recovered. A separate diagnostics patch adds fixed failure categories and
safe response metadata without exposing bodies, SDP, credentials or raw errors;
it does not retroactively establish provider or terminal invocation receipts.

PR933 identifies a concrete runtime failure: native Workers Request rejects
`redirect:error` before dispatch. Both create and hangup used that unsupported
option. The same option existed in account-deletion confirmation delivery. All
three now use manual redirects; 3xx responses stay uncertain and are not followed.
A native Workers regression failed against the previous implementation; all 23
runtime tests and 91 focused Node checks pass after the fix. Development app at
`398746a` and deadline worker `68e76176-34eb-40b4-a4a7-30a8a47b34c3` are deployed,
with new arms still paused. QA deadline worker `241a124f-b20d-40c8-8201-b5dd31684263`
also contains the fix and remains paused. The original unknown row is retained for review.
No credit was reserved for it. This code finding does not invent an old receipt.

## Analytics repair

At the correct test property502443078, stream12184859894, measurementG-VH888WWY3M,
the Measurement Protocol panel explicitly showed no API secrets, despite an
encrypted secret existing in Cloudflare. The Google Create control was available
without an acknowledgment prompt. A new QA-only entry named
`JobHackAI QA revenue delivery 2026-09-20` was created. On the owner's explicit
request, its value was transferred directly from the named settings row into
Cloudflare's encrypted `GA4_API_SECRET` field without printing, photographing,
saving to disk or putting it in chat. The temporary browser-runtime variable was
cleared. Cloudflare confirmed encrypted storage; secret-update worker version
`4b327db8-e3ff-40e7-9c7f-7af4f6b462eb` kept delivery false.

QA Sandbox delivery was enabled from the reviewed worker source, version
`c4cfacab-0966-4505-b9ef-7109732fe244`, on a five-minute cron. No production
or development delivery was enabled. The following are real Stripe Sandbox
transactions and actual Google DebugView observations, not business revenue.

| Test | Stripe charge | Capture | Succeeded refund | Net before fees |
| --- | --- | --- | --- | --- |
| Initial purchase, no campaign context | `ch_3UHxfAApMPhcB1Y617iL36nQ` | $39 | $39 | $0 |
| Tagged article through checkout | `ch_3UHy6SApMPhcB1Y618ne114q` | $39 | $10 | $29 |

The initial checkout at 03:13 UTC had actual GA client/session identifiers but
NULL first/last campaign touches. Google independently showed its purchase with
matching transaction ID, USD and value 39. Its full refund at 03:38 UTC,
`re_3UHxfAApMPhcB1Y61fUmpBYU`, was recorded once as succeeded in QA D1. Google
subsequently showed the matching transaction/refund IDs, USD and value 39.

After QA promotion, a fresh externally tagged article visit loaded exactly the
QA Google tag before its CTA opened QA pricing and Sandbox checkout. The new
checkout retained both first and last touches:

- Source: `linkedin`; medium: `organic_social`.
- Campaign: `qa_cross_site_20260921_0340`; asset: `qa_pack_04`.
- Actual GA client and session identifiers; no synthetic identity.

The second $39 purchase completed at 03:41:18 UTC and joined that exact context.
A $10 partial refund at 03:44 UTC, `re_3UHy6SApMPhcB1Y61ZaTWYvw`, succeeded in
Stripe and D1, leaving $29 net collection before fees. At 03:45:53 UTC Google
received both events. Expanded DebugView parameters independently verified:

- Purchase: exact charge ID, USD, value 39, and both first/last source, medium,
  campaign and asset values listed above.
- Refund: exact charge and refund IDs, USD, value 10, and matching first/last
  campaign and asset values.

All four deliveries had one attempt and HTTP 204, followed by independently
observed Google receipts. Their recorded state was `accepted_unverified`; it
was not manually relabeled. These checks prove the consented campaign context
reached collected money and its partial refund in the QA property. Processed
GA native attribution/report totals and production measurement remain open.
The earlier missing tags were not backfilled; their exact cause is unproven.
No fabricated purchase, timestamp change or guessed campaign was used.

## Cross-site withdrawal follow-up

The real QA withdrawal removed both test checkout contexts and their delivery
rows while preserving the two captures and succeeded refunds. However, a fresh
marketing page still loaded Google and displayed Analytics enabled. Investigation
found that authenticated consent writes deleted the anonymous browser record.
Marketing has no authenticated token; its next GET therefore returned no decision
and the host reused an older cached grant. This is a release blocker.

The fix atomically saves separate account and current-browser decisions in D1.
Old combined identity rows are separated without modifying another account's
preference. A browser-write failure rolls back the account write too. Four
regressions failed on the original implementation in actual Workers/D1 and pass
after the repair; all 27 runtime tests and 89 consent/API/attribution checks pass.
Both app and root consent handlers use the same storage helper. QA marketing was
explicitly opted out through its own controls while the repair is promoted.
Repeat authenticated withdrawal and a fresh anonymous marketing navigation on
the deployed fix before closing this gate. Do not claim it already passes live.

The reverse route also needs rejection precedence: an anonymous marketing
withdrawal must override an older account grant when the visitor returns to
the app. Both app/root lookup regressions failed before this follow-up and now
pass. Either account or current-browser rejection blocks collection; an explicit
signed-in grant updates both. All 29 Workers tests and 98 consent, diagnostic,
API and attribution checks pass. Verify both directions after QA promotion.

PR935 and PR937 deployed to DEV; PR936 promoted them to QA at `daf52eb`.
Live directory withdrawal followed by authenticated app navigation now loads
zero Google tags and displays Analytics unchecked. A separate startup race was
also reproduced: an app page can read anonymous consent before Firebase restores
the account, so a browser grant can precede an account rejection. The follow-up
waits for real auth readiness and a consent receipt before loading Analytics.
Early choices remain local/pending until they can be saved with the correct
identity; preference controls remain usable. Two regressions reproduced the old
race, and 106 consent/API/attribution/directory checks pass with the repair.
This startup repair still needs deployment and live retesting.

Google independently received `directory_listing_view` at04:04:08UTC and
`directory_contact_click` at04:04:22UTC with `business_line=local_directory`,
`directory_category=mobile_detailing`, `directory_market=nky_cincinnati`, and
`listing_id=precision-gloss`. The contact event's method is `provider_website`.
No message or quote request was sent; these are QA view/intent receipts.

The QA property had zero custom definitions. Fourteen Event-scoped dimensions
were added and independently verified in its table: `jha_first_`/`jha_last_`
source, medium, campaign and asset, plus business_line, directory_category,
directory_market, listing_id, contact_method and interest_type. No customer or
transaction identifiers were registered as custom dimensions. Processed reports
remain unverified; registering dimensions does not establish historical backfill.

## Directory and owner steps

The [bounded experiment](directory-experiment-scorecard.md) fixes category,
market, four-week window, spending/effort limits and decision rules. Its review
clock starts only at verified public launch. Public release, indexing and final
campaign publication remain held until the tested release package is reviewed.

Live QA filtering and reset passed. Keyboard activation of Skip to content
scrolled but left focus on BODY. The candidate adds `tabindex=-1` to the shared
main target on all eight generated pages. Local candidate browser verification
now reports activeElement MAIN#main after Enter; three existing consent tests
pass. No new tracking or publication behavior was added.

Both development and QA authentication were verified after the owner signed in.
No new login is currently requested; preserve the tabs. A fresh availability
question for the corrected voice test is pending; do not start the microphone
unattended or repeatedly ask for the same answer. The private Analytics
secret request is CLOSED; do not repeat it. The first voice attempt failed as
recorded above, so spoken-ending acceptance remains untested on this transport.

Marblism Brain confirmed saving "Directory pilot — NKY and Cincinnati — bounded
launch brief". It includes the experiment limits, campaign ID, agent draft
assignments, owner decision delivery and trust-first editorial requirements.
The controlling campaign register was also saved and reopened at 03:30 UTC with
current staging, secret, purchase and voice findings, superseding stale PR913
status. Saving shared instructions is not agent acknowledgment, publication, or
completed campaign work. All public release and outreach switches remain held.

QA analytics consent was explicitly enabled through Cookie Preferences before
revisiting the tagged QA blog. The rewritten practice-options link stayed on QA
and opened the $39 Interview Pack Stripe Sandbox checkout. Payment and actual Google
receipt were verified as described above. A second tagged checkout was opened
but left unpaid; its campaign touches are also NULL. QA marketing was observed
with no Google tag while the app had consent. PR932 adds on-page footer cookie
preferences, so a visitor can change the marketing host preference directly.
All 52 consent tests and local browser grant/withdraw controls pass. The fresh
post-promotion tagged handoff and collected purchase succeeded as recorded above.
Do not backfill missing tags on the earlier purchases.

Remaining release evidence includes actual managed call creation/end/reconnect/
deadline behavior, saved report and entitlements, complete usage reconciliation,
processed campaign revenue reports and consent-withdrawal delivery checks,
disposable-account privacy/lifecycle checks,
directory inbox receipt and production-specific rollout verification. Do not
call these completed because local tests or configuration checks passed.
