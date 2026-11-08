# Scoped voice QA candidate, November 7, 2026

Prepared from development revision 0571ea808878801f6e4d75168cbd4b5c56713e39,
with the accepted physical-device recovery in 2ede5818013b3df4d608ebdad184932dddf97949,
label-only follow-up in 19698b4ead5c77fe06b025a29875c1ce455a0b71 and history
accessibility fix in d7f79cfce0a9f39ff09544c5d91ce47852a3bf27 and report privacy
fix in 19644437698f5cb2066945b9f778b7777b92d0a6, conversation controls
in c77200d8c9de728088c218896c28f72d4b079621 and report control filtering
from PR #1177 candidate 22de0cd00093db47c205712d1b798a05204c3964, against QA
revision 4c7fec4974c0285688ebed02f19a6bc17947b761. This remains a draft candidate,
not a statement that all development or QA acceptance is complete.

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

Before this app PR merges:

1. Complete or explicitly disposition the remaining network-loss, supported-
   browser, accessibility, free-account and other live acceptance cases in the
   original release plan. Physical AirPods recovery is now passed.
2. Resolve the failed November 7 network recovery and both provider-closure
   evidence holds. The network test saved one feedback-only report and used
   one credit, but hangup returned HTTP 404 and no replacement was opened.
   The new response body was not recovered; do not describe it as empty.
   The separate mid-answer outage remains not run. OpenAI case 19425445 has
   received the owner-approved organization/project identifiers and fresh
   reproduction. Neither call's terminal state is verified. An elapsed
   application deadline or a generic 404 does not establish provider closure.
3. Land the separate worker/schema promotion through the Voice Worker Release
   pipeline. Verify migrations 033 and 035, the existing QA namespace, matching
   worker and app credentials, and enabled scheduling before the app deploys.
4. Rebase on that verified QA infrastructure revision, run final candidate CI,
   then merge only this scoped app candidate to develop.

After deployment, verify exact served code, real audio, credit accounting,
saved report and provider closure on QA. Only a QA-accepted candidate may be
promoted to main. The old direct-to-main PR #1032 is not this release candidate.
