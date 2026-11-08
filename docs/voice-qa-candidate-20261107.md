# Scoped voice QA candidate, November 7, 2026

Prepared from development revision 0571ea808878801f6e4d75168cbd4b5c56713e39,
with the accepted physical-device recovery in 2ede5818013b3df4d608ebdad184932dddf97949
and label-only follow-up in 19698b4ead5c77fe06b025a29875c1ce455a0b71, against QA
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
- Reports distinguish limited evidence from an eligible practice score and
  preserve grounded feedback, history access and retention redaction.
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

The scoped candidate passes 391 Node test entries across the voice files,
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

Before this app PR merges:

1. Complete or explicitly disposition the remaining network-loss, supported-
   browser, accessibility, free-account and other live acceptance cases in the
   original release plan. Physical AirPods recovery is now passed.
2. Resolve the independent historical provider-closure evidence hold through
   authoritative provider evidence. Support case 19425445 requests the API
   organization/project identifiers and has not verified the call's terminal
   state. Do not turn an empty 404 into a success.
3. Land the separate worker/schema promotion through the Voice Worker Release
   pipeline. Verify migrations 033 and 035, the existing QA namespace, matching
   worker and app credentials, and enabled scheduling before the app deploys.
4. Rebase on that verified QA infrastructure revision, run final candidate CI,
   then merge only this scoped app candidate to develop.

After deployment, verify exact served code, real audio, credit accounting,
saved report and provider closure on QA. Only a QA-accepted candidate may be
promoted to main. The old direct-to-main PR #1032 is not this release candidate.
