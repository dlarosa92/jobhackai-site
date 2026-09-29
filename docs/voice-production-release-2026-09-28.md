# Voice production release coordination

Owner instruction, September 28, 2026 Eastern: Codex owns the Voice Mock
Interview production release, marketing site, frontend and Marblism social
campaign. Sebastian tests when needed. He confirmed that the public name remains
**JobHackAI Voice Mock Interview**. Routine implementation, editorial decisions
and publishing within this scope are authorized. Earlier approval-only holds
are superseded by this instruction; technical acceptance requirements remain.

**Status: production is not ready. No voice launch has been published.**

## September 29 reconnect fix and controlled acceptance

The transport failure was reproduced and fixed. PR963/964 added a QA-only
generated-silence check and fixed-category provider diagnostics; PR965 isolated
diagnostic cleanup from authoritative state persistence. The normal-close case
returned 200. The dropped-transport case returned 404 with the exact structured
provider error `call_id_not_found` / `invalid_request_error`, which previously
left the old attempt uncertain and made reconnect return 409.

PR966/967 recognize only that exact JSON status/code/type for an already-owned
call with its original issuing key. Generic 404s, message text, other errors and
timeouts remain uncertain. Previously uncertain attempts are never replayed or
reclassified. A distinct `provider_absent` receipt is logged before the old
attempt is saved as closed.

At 12:38–12:39 UTC, the controlled QA retest passed on application revision
`bbf67df81e77c1a2f0db4534df08d28e9ed17de0`, deployment
`0dbf7433-912c-4160-ab42-c20b7d130831`, and deadline Worker version
`8eb1e957-83b9-4eaf-a203-71769f7cf5ee`. The browser connected, dropped its voice
transport while the network remained online, and reconnected under the same
application interview. The provider confirmed the old call absent; the new
call returned 201 and its data channel opened. Finish returned 200, the new call
returned 200 on hangup, and completion returned `saved=true`,
`connectionClosed=true`, `closureNeedsReview=false`. Both attempt rows are
closed. There is one interview row, one reservation, and the original deadline.
The visible allowance changed from 51 to 50: reconnect consumed no extra credit.

This is a transport acceptance result using silence, not proof of spoken
continuity, naturalness or report quality. The original Scrum Master report is
still present. Historical staging holds remain one in development and four in
QA, including the deliberate pre-fix reproduction. They were not cleared.

The retest also exposed a history rendering defect: completed methodology-v2
reports with `tooShort=true` and no score fell through to “Scoring…”. The
candidate now labels ready unscored reports “Not scored”. PR968/969 are merged.
At 12:45 UTC, the signed-in QA browser confirmed all three silent checks show
“Not scored”, the original Scrum Master score 48 remains, and allowance is 50.
The loaded script is `voice-interview.js?v=20260929-history`; the deployed retry
button's computed bottom margin is 24px. At that check, QA canonical
revision was `e1d16c215ac95afa8b0da86b727d19dca229be8e`, deployment
`e57e2c3f-b6c2-44cc-8cbd-56d21fa88fe6`. The deadline Worker is unchanged;
its enabled flag and matching bindings were independently reverified.

Validation for the reconnect patch: 119 provider/interview/diagnostic/recovery
tests and 32 native Workers/D1/DO tests pass, including exact-error recognition,
same-credit/same-deadline reconnect, ambiguous-error holds, failed persistence,
and deadline cleanup. Worker typecheck and both staging dry runs pass. The
integrated production candidate passes 126 targeted Node tests; all 38 client
checks pass with the history label change.

Current remaining acceptance: supervised spoken reconnect/ending and listening,
spoken report precision/usefulness review, and production schema/configuration/
checkout verification. The production release and campaign remain unpublished.

## September 29 account display and coaching evaluation

PR970 and PR971 merged after all applicable current-head CI and Bugbot checks
passed; deployed-base E2E was explicitly skipped. Paid pack ownership now comes
from the server even when voice is paused and a prior subscription cache says
free. The response separates feature availability from entitlement lookup
status. Failed lookups retain the cached display state and show a retry message;
healthy free accounts remain readable during a feature pause. New tests cover
paused pack/free accounts and lookup failures; existing entitlement tests pass.

As of 13:26 UTC, development is at
`dab567a61eb4336e8a44addb4f589d746506cb83`, deployment
`a954d34e-9b3c-413d-a793-98b38add007e`. QA is at
`072c63eb299e8328b3c229e0fae159445a17580c`, deployment
`faf5ddb2-50c5-4bad-8d04-0682e93b09be`. Following model comparison and evaluator
cleanup, canonical QA is `aa5e3338-813a-4792-a983-0761221abe0c` on that same
revision, with GPT-4.1 report configuration and no evaluator operator or expiry
values. The signed-in browser confirms evaluation access is unavailable.
Historical evaluation deployment windows expire by 13:43:06.985 UTC.
The candidate report scorer, shared
guidance and fictional fixtures match the deployed QA source byte for byte.

The synthetic coaching tool initially used seven fixed fictional fixtures and the exact
report scorer. It creates no voice calls, interview rows or credits. It is
restricted to an explicitly nonproduction environment, a configured operator UID
and a short expiry, and returns 404 in production. QA access is temporary for this
evaluation; remove its two configuration values and verify runtime expiry after
collecting results. Unit tests cover those gates and fixed-input enforcement.
The first real-model run was structurally valid but failed semantic acceptance: it
penalized unasked skills, limited project scale and honest uncertainty, and
discounted a qualitative outcome. PR972/973 tighten those rules; the follow-up
PR974/975 distinguishes an explicitly requested number and adds an eighth case.
The repeat improved several cases but still failed qualitative-outcome
acceptance. A same-code, same-input GPT-4.1 comparison corrected that penalty.
QA keeps GPT-4.1 for written reports during supervised acceptance; the realtime
voice is unchanged. The comparison is not an all-clear on factual precision: the
acceptance note records remaining transcription interpretation and scope wording
limitations. See `voice-coaching-acceptance-2026-09-29.md` for exact results and
usage. Development retains its prior report-model default, and production has
not changed. Make the report model explicit at production cutover.

The authenticated provider usage view for September 29 showed rounded project
spend of $0.02, 17,850 tokens and three requests at approximately 12:50 UTC. Its
Realtime model breakdown names `gpt-realtime-mini-2025-12-15`. This is a rounded
project snapshot, not a verified per-interview cost or margin. The earlier spoken
QA record contains observed client usage plus report-model usage, with
`cost_usd=null`; do not substitute those observations for provider billing.

## September 29 initial supervised QA result

At 10:50 UTC, QA was independently reverified at `ca637be87ff0acd5bcbc9aee9edf369c5228287d`
and canonical deployment `9914e691-e126-43cc-bfeb-3f15b9607458`.
The owner tested a Mid-level Scrum Master interview, turned Wi-Fi off and back
on, clicked Reconnect, then attempted recovery. Reconnect failed and the app
saved a 124-second interview with `end_reason=connection_lost`, six transcript
turns, a methodology-v2 scorecard and rendered score 48. There is one provider
attempt for that application session; no replacement call was created. Its
hangup returned HTTP 404 and the ledger remains `uncertain` / `close_http_404`
with no provider closure timestamp. This adds one QA uncertainty to the two
historical QA records described below. No record was reconciled or retried.

The owner confirmed that Retry finishing appeared ineffective and supplied
screenshots showing the button touching the report heading. PR961 (development)
and PR962 (QA) distinguish technical review from a retryable in-flight closure.
An acknowledged saved report no longer offers an ineffective retry or traps
the user with a leave-page warning. Genuine save failures and in-flight closures
retain recovery. The provider hold remains intact. Status and retry spacing are
24 pixels above the report; this was measured in a browser using a synthetic
local preview. All 139 targeted client/provider/reservation/reconciliation and
account-operation checks, the app build and Pages Functions compilation passed.
These fixes are also included in this production candidate. They do not fix
the underlying reconnect failure or establish live voice acceptance.

The owner also reported that the voice may have sounded robotic, with uncertainty
about the speakers. Treat naturalness as unresolved. The tested configuration is
`gpt-realtime-mini`, `marin`, output speed 0.9 and semantic VAD. No audio recording
was available to assess the sound, and no voice/model/pacing change is justified
by the screenshots alone. A future controlled listening comparison must keep
the device, network and substantive question consistent before attributing it.

The bounded prospective log collector captured provider creation (HTTP 201),
but the local Wi-Fi interruption disconnected the Pages tail before hangup.
It stopped at its 20-minute limit. Persistent D1 metadata supplies the 404
category; the authenticated provider Realtime log view has no saved traces.
No native historical Pages invocation recovery path was found. Absence of logs
does not confirm closure. Preserve the private session/attempt receipts in the
local QA evidence files; do not publish user identifiers or transcript content.

The gates at the end of this initial run were provider closure/reconnect evidence, live reconnect continuity,
spoken ending (not reached in this run), natural voice quality, seven real-model
coaching cases, and production migration/configuration/checkout acceptance.

## Verified starting point

Read from GitHub and Cloudflare on September 29 at approximately 02:29 UTC.

| Surface | Canonical revision | Observed state |
| --- | --- | --- |
| Development app | `c1e944f30451a99a6bcaa12e27959c536b9a3410` | Managed transport true; matching D1 and deadline bindings; new deadline arms disabled |
| QA app | `cf419cea5a65056547ff398ac8d24326d941d1f6` | Managed transport true; matching D1 and deadline bindings; deadline worker enabled |
| Production app | `13e59270b1847b3f5b18d7e9f14f6b652b275139` | No managed voice flag or deadline binding in canonical deployment |
| Production marketing | `13e59270b1847b3f5b18d7e9f14f6b652b275139` | Static marketing directory; no build command |

Production deployment IDs: app `a24bcf9c-07d4-4c55-b9f2-7cdec4b0ae3e`,
marketing `b6051278-49a8-4e8c-8d19-d2b497065ae1`.
Both canonical production revisions and deployment IDs were reverified unchanged
on September 29 at approximately 12:58 UTC.

The original working directory remains on an older dev0 checkout with untracked
UI/artifact files. Work is isolated in `codex/voice-production-release-20260928`.
PR941 merged to dev0 at 02:37 UTC as
`f0678227deb9036a9df8fd62c67834d67eabd5e6`. Cloudflare canonical development
deployment `c400c8dc-518a-4231-900d-f03dda9e469c` succeeded and has the expected
managed flag, RPC, D1 and deadline namespace. Its new deadline arms remain off.
PR959 promotes only PR941's two commits to QA; it merged at 02:43 UTC as
`ca637be87ff0acd5bcbc9aee9edf369c5228287d` after all applicable CI checks passed.
QA canonical deployment `9914e691-e126-43cc-bfeb-3f15b9607458` succeeded at that
exact revision, verified at 02:44:55 UTC. Its managed flag, RPC, D1 and deadline
bindings match; deadline scheduling remains enabled. The signed-in QA page now
renders the revised setup guidance and JD field. No production code was merged.

## Release acceptance and remaining work

1. **Provider lifecycle.** The controlled transport retest now passes as
   recorded above. Historical staging uncertainty remains an operator recovery
   follow-up, not evidence that those calls are still running. Follow
   `voice-call-reconciliation.md` with actual receipts; never infer historical
   closure from age, generic 404s or the behavior of a different test call.
2. **Report quality.** PR941 replaces the fixed 5/10/85 scoring target with
   role/level evidence, grounded quotes, unassessed skills and no numeric grade
   for insufficient candidate speech. Local integration checks pass. The seven
   synthetic real-model cases ran on QA and exposed semantic feedback defects.
   The evidence and follow-up are in `voice-coaching-acceptance-2026-09-29.md`;
   a repeat adds an explicit numerical-question boundary. The repeat still
   overemphasized missing metrics, so the existing GPT-4.1 report fallback is
   retained on QA after correcting that observed penalty under the same inputs
   and prompt. Remaining precision/usefulness notes accompany supervised
   acceptance. The realtime voice is unchanged.
3. **Live acceptance.** With the transport fix deployed, run supervised
   reconnect and spoken ending, inspect the persisted transcript/report, and
   verify no extra credit on reconnect. Check mobile audio and report readability.
   Codex runs technical checks; Sebastian judges spoken pacing and usefulness.
4. **Production preparation.** Inventory exact production schema, current
   Stripe live offers, environment isolation, provider bindings, usage/cost
   evidence, privacy/consent behavior and rollback before deployment. Source
   existence or staging receipts are not production acceptance.

The current OpenAI reference documents the Realtime hangup endpoint for both
WebRTC and SIP, but supplies no observed receipt for these attempts:
https://developers.openai.com/api/reference/python/resources/realtime/subresources/calls/methods/hangup
Do not confuse newer GPT-Live close events with this existing Realtime stack.

## Local verification completed

- Baseline `npm run test:voice` and full `npm run test:billing`: passed.
- Managed provider, interview, client and recovery suites: 120 tests passed.
- Deadline worker TypeScript check and native Workers/D1/DO tests: 31 passed.
- Candidate with PR941: voice suite and coaching tests passed; consent, usage
  and managed-client group: 89 tests passed.
- Shared marketing assets match source.
- The production app build passed; 11 blog CTA/directory consent checks passed.
- The QA promotion candidate separately passed 4 coaching and 68
  client/usage/consent checks, shared asset verification and diff whitespace checks.
- PR941 has no GitHub review threads. Existing remote checks passed, with its
  deployed-base E2E check skipped. That skip is not candidate browser acceptance.

Local execution intercepts provider traffic. These results do not prove live
reconnects, report quality, actual usage cost or successful publication.

## Commercial and UI consistency

The implemented beta offer and reviewed support copy use one lifetime free
voice interview with a partial feedback preview, $17 weekly, $34 monthly and
a $39 five-session pack valid for 90 days. Subscription allowance is 60 sessions
per UTC calendar month. The July canonical-pricing proposal says $19 Sprint and
$39 Monthly, but is still labelled proposed and is not the implemented offer.
Do not silently mix these or migrate billing as a side effect of marketing.
Verify the live sale configuration before publishing any price.

Live production inspection at 02:41-02:42 UTC found no voice_sessions,
voice_interview_controls, voice_provider_calls, account deletion recovery,
collected payment, checkout attribution or analytics delivery tables. Users lack
the migration019 terms/privacy and migration020 voice entitlement columns.
The existing billing audit tables and directory_requests are present. Do not
blindly replay all migrations: inspect each expected column/index/trigger and
preserve the already applied billing and directory schema. Prepare additive
019-021 and 024-029 changes with an export/restore point and verify exact state
before applying. No production migration has run in this task.

Schema-only rehearsal at 02:51 UTC: exported 66 schema objects (no user rows),
loaded them into local SQLite, and successfully applied 019, 020, 021 and
024-029 in sequence. Local integrity_check returned ok, with 114 resulting schema
objects and both end_reason/usage_details_json voice columns. This verifies SQL
compatibility with the observed schema, not migration of live user data. Remote
read-only checks confirm both migration023 unique Stripe indexes already exist
and duplicate customer/subscription groups are both zero; do not rerun the old
billing repair or migration023 as part of this release.

The authenticated live JOBHACKAI LLC Stripe catalog initially contains exactly
three products: Essential $29/month, Pro $59/month, Premium $99/month. No voice
offers exist in the all-products list. Browser access works; the Stripe
connector itself needs reauthentication. Browser setup created and independently
verified these three additional live products and default prices:

| Offer | Product ID | Price ID |
| --- | --- | --- |
| USD17 weekly | `prod_VLY7kTytUDeYtj` | `price_1UKr1SApMPhcB1Y6Hsn3ADc3` |
| USD34 monthly | `prod_VLY844NVx2N1jD` | `price_1UKr2MApMPhcB1Y6LeQwi39g` |
| USD39 one time, five sessions/90 days | `prod_VLYA715GwrgeZo` | `price_1UKr3tApMPhcB1Y6a3OGUM7X` |

Created at 02:44:02, 02:44:58 and 02:46:33 UTC respectively. Weekly/monthly
descriptions explicitly disclose the 60-session UTC-calendar-month allowance.
No trials, payment links, charges, subscriptions or account tax changes were
created. Existing products/subscriptions remain unchanged. These price IDs have
not yet been wired into production Cloudflare; catalog creation is not checkout
or entitlement acceptance.

Use the existing voice-first homepage, pricing, dashboard, free-tool CTAs,
voice setup/live/report/history and shared design system. Preserve the live
Local directory and its campaigns. Do not merge all staging changes into main
without reconciling the current production directory changes and release scope.
Publish app capability before marketing sells it; marketing main deploys at once.

An isolated production integration candidate now exists at
`codex/voice-production-candidate-20260928`, based on current main plus the tested
QA revision. It resolves 18 merge conflicts: production directory data, pages,
runtime, generator, tests and experiment documents are retained; QA's deployed
E2E safeguards are kept; marketing preview protections are combined; the sitemap
retains all 35 production entries and adds 11 distinct QA entries. Directory
files/data/generator have no content diff from main, and application Functions
initially matched the tested QA revision. All 74 marketing tests and the app production
build pass. This candidate is preparation, not production acceptance or deploy.
Draft production PR: https://github.com/dlarosa92/jobhackai-site/pull/960.
The accumulated feature release is large (367 files before these release notes)
and includes voice, billing/consent/account-lifecycle dependencies. Keep it draft
until live acceptance and production migration/configuration are complete.

The first candidate revision passed all applicable remote checks. Browser
inspection then reproduced duplicate cookie banners on the exact marketing
preview during authentication restoration. The candidate now preserves one
actionable banner and dismisses it when the restored account already has a
decision. All three new regression cases failed before the fix; all 106 consent,
attribution and diagnostic checks pass after it. The shared marketing copy is
synchronized. The only application Functions change relative to QA is this test
harness/regression coverage; server runtime Functions remain unchanged.

Production deadline configuration is now explicit in
`workers/voice-deadlines/wrangler.jsonc`, targeting the live-verified
`jobhackai-prod-db` ID above with `VOICE_DEADLINES_ENABLED=false` and no public
route. Type generation/typecheck, all 29 current native worker tests and a
production dry-run build passed. CI also checks the production dry run. This
does not create a worker or enable scheduling. A private OPENAI_API_KEY matching
the production Pages key must be provisioned before activation; no such key is
present locally and encrypted Cloudflare secrets are not readable for copying.

Cutover order after live acceptance: take the production recovery point, apply
and verify the additive schema, provision the isolated deadline worker/binding
and live price mapping, and deploy the pinned candidate app to the production
app project. Verify that exact deployment and entitlement/closure behavior
before merging main to publish marketing and converge the Git deployments.
Preserve the old app/marketing deployment IDs above for rollback. Do not rely on
simultaneous app and marketing auto-deploy timing.

## Campaign execution

Marblism access verified. Instagram, LinkedIn and Facebook show connected.
Facebook is the Local directory page and is excluded from voice distribution.
The LinkedIn destination is now independently verified as the JobHackAI company
page, https://www.linkedin.com/company/jobhackai/. Sonny's saved provider readback
identified organization URN `110918089`. On September 29 at approximately
12:55 UTC, Codex opened that company ID in LinkedIn: its admin page identifies
JobHackAI and displays the same two Local posts reported by the provider. View
as member resolves to `/company/jobhackai/?viewAsMember=true` and explicitly
identifies the Organization page for JobHackAI. This closes the destination
blocker; the personal-looking integration handle is not the publishing entity.
Sonny confirmed the bounded destination update in the existing voice campaign
register at 12:55 UTC. At 13:01 UTC he returned the six current draft IDs below
and confirmed section 3 now uses those IDs, with older versions marked
superseded. This is his saved-register readback, not publication evidence.
No post, schedule, connection or Local campaign was changed.

Sonny received the owner delegation and six exact revised captions. He returned
saved draft version IDs; all six captions were independently observed in the
native Drafts list. No launch URL, publication time or schedule was supplied.
The native ellipsis menu has Duplicate/Delete only; historical internal titles
cannot be renamed there. Correct editorial titles are recorded in the Brain
register; unsupported historical percentages must not be exported. Two Instagram
captions were revised again to match existing artwork and independently read in
the native Drafts list. No old or superseded draft is approved for publication.

| Intended title | Platform | Current draft version |
| --- | --- | --- |
| Practice the follow-up | LinkedIn | `93a7a772-abb3-4e8d-af33-4e38d8869289` |
| Make your contribution clear | LinkedIn | `d30f0a8d-4571-44a7-8e7a-ac61883b701d` |
| Tell me about yourself: three prompts | LinkedIn | `a877ca3a-133b-4c8b-b338-9560d1cbfaf4` |
| Turn the job posting into a practice sheet | Instagram | `22a78838-9c38-48ea-8eff-05d0e58705a3` |
| The 90-second answer check | LinkedIn | `024ac253-1173-461d-8311-2d8d244c4c95` |
| The 90-second answer check | Instagram | `a6d0919b-e518-4aa7-a9cc-644637a9f1cd` |

Penny received a bounded request to return the existing introductory-question
article and its sources. Codex owns the repository edition and real site
publication; Marblism's article status alone cannot prove the site is live.
The existing draft is `62450f7e-2166-4d50-bf60-afa239330052`. Its body was read in
the native editor with no generated images. Penny confirmed the saved draft and
text-only export contain zero image references, remain DRAFT and unscheduled,
and retain their sources and illustrative-example labels. The repository edition remains the
controlling article with its plain title, two labelled fictional examples and
source links. No additional articles or assets were requested.

## Next supervised QA session

After exact QA deployment verification, reload the signed-in voice page, use a
real target role and optional job description, and answer two or three questions
with truthful examples. The new report should identify assessed competencies,
quote those answers accurately, mark unasked areas unassessed, and give useful
next practice steps. There is no fixed 5/10/85 target; old runbook expectations
for that formula are superseded for methodologyVersion2.

Capture prospective Pages and deadline-worker logs before the reconnect test.
After context is established, briefly interrupt the network, restore it and use
Reconnect. Confirm continuity and no extra credit. End with a spoken request.
Codex checks provider close receipts, session/end reason, transcript exclusion of
the control phrase, report persistence and usage evidence. Sebastian judges
spoken pacing and feedback usefulness. Do not start his microphone automatically
or mark historical uncertain attempts closed based on this new test.

All prospective collectors are stopped. For the next spoken check, start
`/tmp/jobhackai-provider-probe-receipts-20260929.mjs` against the then-current
QA deployment. Its 20-minute capture stores sanitized invocation/provider
metadata, not headers, bodies, SDP, audio or transcript. Verify a real history
refresh reaches the collector before testing. The owner was asked at 12:46 UTC
whether he can do the spoken test now or later; no answer has arrived and no
microphone session has been started by Codex.

Editorial rules: direct language, useful exercises, factual product descriptions
and clearly labelled examples. No fabricated statistics, testimonials, founder
stories, candidate results, fake product screenshots, generated handwriting,
guarantees or invented urgency. Replace mismatched assets before scheduling.
Use distinct platform/content tracking parameters only after destinations work.
Preserve existing directory schedules and links. No new paid spend or unrelated
outreach is part of this release.

## Completion evidence required

Record the tested app/marketing revisions, migrations and bindings, supervised
voice results, correct live checkout/entitlement behavior, real analytics
receipts, rollback targets, final live URLs and native public post URLs. A
submitted prompt, saved draft, successful build or scheduled post is not a
completed production launch.
