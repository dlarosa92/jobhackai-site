# Scoped voice QA candidate, November 7, 2026

Prepared from development revision 0571ea808878801f6e4d75168cbd4b5c56713e39
against QA revision 4c7fec4974c0285688ebed02f19a6bc17947b761. This is a draft
candidate, not a statement that all development or QA acceptance is complete.

## Included behavior

- Audio setup checks microphone and output before consuming an interview;
  server readiness owns the transition from setup to the interview deadline.
- Full sample playback, muted replay, explicit Start, usable-speech gating,
  caption ordering, bounded follow-ups and polite Finish handling.
- Audio help pauses questions, replays the displayed question and resumes
  after unmute. Setup-only Start controls stay hidden during live recovery.
- Reports distinguish limited evidence from an eligible practice score and
  preserve grounded feedback, history access and retention redaction.
- The existing once-per-account early-end grace has matching schema support.
- The silent connection diagnostic uses uncharged setup and never activates
  an interview. Its version matches the connection endpoint protocol.
- Shared role selection records the actual tool in analytics and uses a fixed
  label for custom role text. GA4 and Clarity remain enabled.

All changed voice runtime files match the cited development revision. The
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

Before this app PR merges:

1. Complete or explicitly disposition the remaining physical device/reconnect,
   supported-browser, accessibility, free-account and other live acceptance
   cases in the original release plan.
2. Resolve the independent historical provider-closure evidence hold through
   authoritative provider evidence. Do not turn an empty 404 into a success.
3. Land the separate worker/schema promotion through the Voice Worker Release
   pipeline. Verify migrations 033 and 035, the existing QA namespace, matching
   worker and app credentials, and enabled scheduling before the app deploys.
4. Rebase on that verified QA infrastructure revision, run final candidate CI,
   then merge only this scoped app candidate to develop.

After deployment, verify exact served code, real audio, credit accounting,
saved report and provider closure on QA. Only a QA-accepted candidate may be
promoted to main. The old direct-to-main PR #1032 is not this release candidate.
