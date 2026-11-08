# Scoped voice QA candidate, November 7, 2026

Prepared from development revision 0571ea808878801f6e4d75168cbd4b5c56713e39,
with the accepted physical-device recovery in 2ede5818013b3df4d608ebdad184932dddf97949,
label-only follow-up in 19698b4ead5c77fe06b025a29875c1ce455a0b71 and history
accessibility fix in d7f79cfce0a9f39ff09544c5d91ce47852a3bf27 and report privacy
fix in 19644437698f5cb2066945b9f778b7777b92d0a6, conversation controls
in c77200d8c9de728088c218896c28f72d4b079621 and report control filtering
from PR #1177 candidate 22de0cd00093db47c205712d1b798a05204c3964 and
account-menu accessibility in PR #1178 (14c6707d186bfad072e7a8e0462a535d427b876e), and the explicit-danger safety fix in PR #1179
(d9d475638bf7eaf7e3182e038ca7fb1e9098c09b), compound clarification and longer
closing playback in PR #1180 (2629fab2d8482d25c0b1c0a972409e68a30b7814), and
application-owned planned completion in PR #1181
(e031a6980fc5a321550857e5167a1c233b252e29), against QA
revision 4c7fec4974c0285688ebed02f19a6bc17947b761. This remains a draft candidate,
not a statement that all development or QA acceptance is complete.

## Current: November 8 network retry candidate and live result

Includes PR #1183, merged to dev0 as
69a508227f109aeb1ca8bb82cbcc1c3a8c50c04a and verified on the canonical
development deployment. Temporary reconnect errors preserve the existing
interview, captured answers, mute choice, credit and original deadline. The
user can explicitly retry or finish. Successful replacement requests the
current question again. Retired configuration and greeting timers cannot
close a later recovery attempt. No automatic replacement or provider-hold
bypass is introduced. Safe diagnostics identify failure stage and category.

The refreshed QA candidate passes all 101 managed-client/diagnostic tests,
the full voice suite and the app build. Changed runtime modules match the
development source; the voice page keeps QA's existing header and cookie
asset references. Hosted candidate checks must pass on this new head.

The third recorded Safari network run FAILED recovery on the deployed build.
The browser was offline for 31.521 seconds, then Reconnect was requested
147.432 seconds after it returned online. More than 14 minutes remained on
the original deadline. The application returned 409,
voice_call_close_unconfirmed, with stored provider category
close_http_404:empty:none:none:unclassified. No replacement was created.
This exercised the terminal review safeguard, not the temporary-error retry
branch. The delay is observed; it is not established as the cause.

Both captured answers (71 words total) and one feedback-only report saved and
reopened. One credit was used, and no unended application session remains.
Provider closure is a separate unresolved fact. Four development attempts
now remain uncertain: three unconfirmed closures and the September 21
unconfirmed creation attempt. None was cleared by age or a generic 404.
The owner-approved addendum was sent in OpenAI case 19425445 on November 8.
The immediate-reconnect and mid-answer cases remain unaccepted. Evidence is
in safari-network-recovery-03-review.md and its run manifest in the Brighton
preparation evidence folder. No QA or production promotion has occurred.

## Historical: November 8 durable network-failure evidence

Includes development PR #1182 (merge 7e0b70be3c02b5a842af90d0aa406bedcb1b3d3a).
An unconfirmed hangup 404 now retains the bounded, allowlisted response category
in its existing error field. This distinguishes an empty body, an unreadable
body and structured provider errors if a network interruption also loses the
operator's log stream. No raw body or interview content is added to the ledger.
The exact absence rule, holds, credit behavior and no-replay protections remain.

Seven persistence regressions failed before the fix. Development passed 122
provider/diagnostic/managed-interview tests, 34 actual Worker runtime tests,
type checking, release preflight, the app build and all nine executed PR checks.
Both the app and deadline Worker deployed through development CI. This draft
requires refreshed candidate checks and subsequent deployed QA verification.

The read-only development audit still shows two unconfirmed hangup records,
plus a separate unconfirmed creation attempt from September 21. All three
remain unchanged. The support case has no newer received reply at this check.
Better diagnostics do not establish successful network recovery or retroactively
classify any historical attempt. The next controlled network retest is pending.

## November 8 accepted clarification and planned closing

The first corrected-build Safari run kept both compound clarification requests
on the current question and excluded them from assessment, but its final
wording exposed another completion failure. The app had requested its final
turn yet still relied on recognizing generated words. The owner saved that
failed run manually; it remains recorded as a failure.

The application now enters closing when its turn plan requests the final
response. It stops new microphone input, freezes the countdown and waits for
that response's playback before saving once. Response identity is bound once,
so stale or duplicate responses cannot end it early. The 30-second fallback
remains bounded, and the narrow text matcher is retained only as an earlier
spoken-wrap backstop. Ordinary thanks do not gain a new ending trigger.
The planned closing transcript persists while later candidate chatter stays
excluded. Voice Regression now runs the existing suite at all promotion stages.

Five regression cases failed before this fix. The full voice suite, build,
ten executed PR checks, exact-head code review, five development workflow runs
and three post-deployment UI tests passed. In the recorded November 8 Safari
retest, closing audio played for 9.094 seconds and playback stopped only after
the buffer-stop event. The owner confirmed the full final words and automatic
report opening without clicking Finish or asking to stop. The session saved
with reason completed and its provider closed without error. One credit and
one history entry were used. The report reopened after full navigation.

The short sample correctly produced feedback only: recalculated eligibility
matches the saved 236 words and two substantive answers. All nine quoted
feedback excerpts are grounded in the candidate answers. The complete trace
has 2,211 events with none dropped. Local recording, output transcription,
diagnostics, database evidence and report images are retained in
safari-planned-closing-02-review.md in the Brighton preparation evidence folder.
Recording is stopped. This accepts the scoped clarification and normal-ending
fixes, not the remaining network, cross-browser or original release gates.
The refreshed QA candidate still requires its own CI and deployed QA checks.

## November 8 accepted safety follow-up

The isolated development safety test first reproduced a failure: the model
spoke supportive words but omitted both emergency guidance and its ending tool,
leaving the interview live. The client now owns a bounded safety close for an
explicit standalone current-danger statement. It stops the microphone and
countdown, displays urgent-help guidance, requests a dedicated spoken response,
waits for playback, and saves the safety reason without generating a scorecard.
Stale playback receipts and manual Finish cannot replace the safety reason.
The module-missing fallback also waits for playback and has a bounded exit.
The existing model tool/referral path remains for other wording; this narrow
backstop does not claim comprehensive crisis classification.

Two failing regressions were reproduced before the fix. All 121 client tests,
the full development voice suite, 15 report cases, build, development CI and
post-deployment authenticated UI smoke passed. The owner then heard complete
guidance and observed automatic closure in Safari without clicking Finish.
The saved session has ended_for_safety and a NULL scorecard; the provider closed
without error. Reopening the exact session shows the same scoreless safety
page and Safety history label. One development credit was used. Recording is
stopped. Output-audio capture, diagnostics, read-only database evidence and
reopened screenshots are retained in safari-safety-02-review.md under the
November 7 Brighton training-preparation evidence folder.

This accepts the scoped safety case only. This refreshed QA draft still needs
its own candidate checks and deployed QA acceptance; remaining original gates
below are unchanged. It has not been merged or deployed to QA or production.

## Included behavior

- Audio setup checks microphone and output before consuming an interview;
  server readiness owns the transition from setup to the interview deadline.
- Full sample playback, muted replay, explicit Start, usable-speech gating,
  caption ordering, bounded follow-ups and polite Finish handling.
- Audio help pauses questions, replays the displayed question and resumes
  after unmute. Setup-only Start controls stay hidden during live recovery.
- Physical microphone reconnect preserves the user's mute choice and replays
  the current question once after configuration acknowledgement. Disconnected
  controls stay truthful; connection status does not become stale on unmute.
- Standalone repeat, rephrase, hearing and continuation requests do not spend
  question opportunities. A requested topic change advances deliberately.
  Historical quotations and requests followed by substantive answers remain
  normal answer content. Shared classification excludes standalone controls
  from report assessment, word counts and quote validation.
- Reports distinguish limited evidence from an eligible practice score and
  preserve grounded feedback, history access and retention redaction.
- Direct reports suppress legacy safety-ending scores, matching History,
  including after a paid upgrade. Their deliberately absent score is ready,
  not still generating. Normal reports and transcript entitlement are unchanged.
- Both app navigation builders share a named Account menu disclosure. Its
  expanded state follows opening and closing; Escape returns focus to the
  toggle, and tabbing out closes the menu. Duplicate toggle and per-render
  document click handlers are removed.
- Saved reports expose native links. History selection uses labeled checkboxes
  without replacing the focused control. The deletion dialog initially focuses
  Cancel and returns focus after cancellation; mode changes focus a visible
  control. Obsolete row navigation and duplicate keyboard handlers are removed.
- The existing once-per-account early-end grace has matching schema support.
- The silent connection diagnostic uses uncharged setup and never activates
  an interview. Its version matches the connection endpoint protocol.
- Shared role selection records the actual tool in analytics and uses a fixed
  label for custom role text. GA4 and Clarity remain enabled.

Voice runtime files match the cited development source and follow-ups. The
voice page retains QA's cookie-consent and header stylesheet references;
unrelated dashboard, marketing, directory and retention changes are excluded.
Migration 034 is included as source for the existing disabled retry tests.
It must not be applied, and VOICE_RETRY_ENABLED stays off.

## Validation and remaining gates

The earlier scoped candidate passed 391 Node test entries across the voice files,
including the compiled follow-up Worker with intercepted providers. The app
build passes and generated voice assets match source. These are local tests,
not real microphone or provider acceptance. The development Safari setup,
quiet natural interview, report reopen and Audio help replay/continuation
have separate owner-observed and recorded evidence.

The November 7 Safari/AirPods run also passed physical disconnect/reconnect,
preserved mute, clear current-question replay and a subsequent response.
Exactly one credit was used, the saved report reopened after reload and both
provider connections closed. The complete trace has no dropped events, no
cancelled responses and no cleared output buffer. Capture decoding succeeded
with video timestamp warnings. The label-only follow-up passes the 89 current
managed-client/diagnostic tests and does not change audio behavior. This
physical-device pass does not establish the separate network-loss cases.

The history fix passed 106 client checks and 89 managed-client/diagnostic
checks after cherry-picking into this QA candidate, and its app build passes.
The delivered development JavaScript exactly matches the accepted source.
Canonical-host HTML differs only by Cloudflare's Rocket Loader transformation.
Native Safari on development confirms labeled links and checkboxes, single
Space toggles with retained focus, initial Cancel focus, Escape returning to
Delete selected and mode exit returning to Manage. Local Chrome also verified
Enter navigation, dialog Tab trapping and a 390px layout without overflow.
No real data was deleted or new voice call started. Full Safari keyboard
traversal, screen-reader speech and live 200% zoom remain outside this pass.

The report privacy follow-up adds nine tests executing the real report,
history, selected-delete and clear-history routes against SQLite. Only
Firebase verification uses fixture identities. They cover ownership, forged
IDs, deletion without credit/grace changes, live-session protection, expired
content redaction, free/full report access and legacy safety scores. The
legacy safety fixture failed before the fix. Removing the ownership guard
also caused the expected regression failure; that mutation was restored.
All nine cases, 15 report cases, 15 history cases and 106 client checks pass
after cherry-picking into this candidate. These tests do not establish live
account deletion, scheduled cleanup, provider closure or microphone behavior.

The November 8 Safari controls retest passed nine clarification requests,
a bare example preface and the historical ending quotation. Manual Finish
saved a feedback-only report; it reopened after reload, used one credit and
closed the provider without error. Recording began 102 seconds after activation,
so the initial three requests have owner/transcript evidence only. The remaining
six and ending examples have output recording evidence. The recording decodes
with timestamp warnings; no raw microphone track was captured.

The report follow-up reproduces and fixes four assessment regressions. The
recorded transcript replay retains its one 30-word answer instead of counting
55 words with controls; no provider call or saved-report mutation was made.
The VM-based usage-test harness now supplies the real shared classifier and
the main local voice command includes usage tests. The full voice suite and
build pass in this scoped QA candidate. Four changed voice runtime modules
are byte-identical to the development candidate. This does not establish a
QA deployment or clear the remaining network, privacy or device gates.

The November 8 native Safari setup audit verifies the Role, Seniority, Job
Description and Check audio keyboard order. It exposed an unnamed account
button. PR #1178 fixes both app navigation builders. The exact development
revision and served JavaScript are verified, and native Safari confirms the
named expanded/collapsed state, Return opening, Escape with focus returned,
and tabbing through Account and Logout out to Role with the menu closed.
Neither link was activated. After the owner restored Safari input, mouse
opening and outside-click dismissal also passed, leaving the menu collapsed.
All three development post-deployment UI smoke tests passed in run 42457484409.
Chrome automation still reports an open extension UI on the follow-up attempt;
Chrome-specific and full screen-reader speech remain unaccepted. The menu
checks used no interview credit. A separate voice recording later stopped
without activation; credits remained 28 and history 23, so it supplies no new
voice acceptance. The scoped QA app build passes.

Before this app PR merges:

1. Complete or explicitly disposition the remaining network-loss, supported-
   browser, accessibility, free-account and other live acceptance cases in the
   original release plan. Physical AirPods recovery is now passed.
2. Resolve the failed network-recovery path and four provider evidence holds
   described in the current section. The latest run preserves both answers
   and its report but does not establish coherent recovery. Its stored error
   identifies an empty 404; the older run's missing response body must not be
   retroactively classified. The separate mid-answer outage remains not run.
   OpenAI case 19425445 has the approved identifiers and latest reproduction.
   An elapsed application deadline or a generic 404 does not establish
   provider closure.
3. Land the separate worker/schema promotion through the Voice Worker Release
   pipeline. Verify migrations 033 and 035, the existing QA namespace, matching
   worker and app credentials, and enabled scheduling before the app deploys.
4. Rebase on that verified QA infrastructure revision, run final candidate CI,
   then merge only this scoped app candidate to develop.

After deployment, verify exact served code, real audio, credit accounting,
saved report and provider closure on QA. Only a QA-accepted candidate may be
promoted to main. The old direct-to-main PR #1032 is not this release candidate.
