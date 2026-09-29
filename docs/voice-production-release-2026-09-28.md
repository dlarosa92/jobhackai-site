# Voice production release coordination

Owner instruction, September 28, 2026 Eastern: Codex owns the Voice Mock
Interview production release, marketing site, frontend and Marblism social
campaign. Sebastian tests when needed. He confirmed that the public name remains
**JobHackAI Voice Mock Interview**. Routine implementation, editorial decisions
and publishing within this scope are authorized. Earlier approval-only holds
are superseded by this instruction; technical acceptance requirements remain.

**Status: production is not ready. No voice launch has been published.**

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

## Technical release blockers

1. **Provider closure and reconnect.** Live SELECTs show one development
   `create_unconfirmed` attempt, and two QA attempts with `close_unconfirmed`
   and `close_http_404`. Two other QA attempts are closed. Aggregate categories
   overlap; these are ledger states, not proof that three provider calls remain
   running. No historical state was cleared or retried. The authenticated
   OpenAI Realtime log view currently has no saved traces. Absence is not closure
   evidence. Follow `voice-call-reconciliation.md` only with actual invocation
   and provider receipts. A timeout, old date or 404 cannot be relabelled as
   success to pass the release.
2. **Report quality.** PR941 replaces the fixed 5/10/85 scoring target with
   role/level evidence, grounded quotes, unassessed skills and no numeric grade
   for insufficient candidate speech. Local integration checks pass. The seven
   synthetic real-model cases still require execution and semantic review;
   no development API key is present locally. No model upgrade is included.
3. **Live acceptance.** After closure behavior is corrected, run supervised
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
Native integrations confirms LinkedIn handle `sebastian-larosa-b40b5279`, but
does not independently identify personal-profile versus company-page posting.
The earlier company-page statement is user-reported, not new browser evidence.

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

The current temporary collector is
`/tmp/jobhackai-voice-qa-receipts-20260928.mjs`, maximum 20 minutes, writing private
sanitized invocation/provider metadata to its same-name `.jsonl`. It stores no
headers, bodies, SDP, audio or transcript. A real QA `/api/voice/sessions` refresh
at 02:46:33 UTC confirms Pages capture works. The owner has been asked whether he
can do the short supervised test now or later; no voice session has been started
by Codex. Restart capture on the then-current deployment if the test is later.

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
