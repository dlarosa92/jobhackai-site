# Voice reply recovery

## Problem and evidence

During development acceptance on November 3, 2026, candidate captions kept
arriving while the interviewer stopped replying. Background speech was present.
The interview reached its original deadline, saved its report, and closed its
provider call. The available transcript does not establish which realtime event
was missing, or prove that Safari or background speech caused the stall.

Local event-driven regressions reproduced two indefinite waits: a committed
input whose final transcription never arrives, and an interrupted assistant
item whose final caption never arrives. Both prevent `drainTurn` from requesting
the next reply. The old response timeout started only after `response.create`,
so neither wait had a recovery path. Six initial regression assertions failed
on the old client.

## Behavior

- Settle assistant captions from terminal output-item and response snapshots as
  well as the separate transcript event. Deduplicate final items and preserve
  existing echo filtering. An empty final item retires its placeholder.
- After 15 seconds waiting for a reply following a committed turn, offer
  **Reconnect**. Continued speech cancels this wait. This does not force a reply
  over speech or classify background speech as an interview answer.
- An active response that exceeds the existing 45-second request timeout also
  offers recovery. Audio-setup failure behavior remains unchanged.
- A connected transport cannot hide reply recovery. If delayed audio actually
  begins before the candidate reconnects, clear the recovery state and continue.
  Legacy transports also clear recovery when the matching reply completes.
- Reconnect replaces the provider attempt within the same interview, retains
  captured transcript text, removes unresolved caption placeholders from the
  retired connection, and requests the current question again without spending
  a topic opportunity. The original deadline keeps running; no extra interview
  is activated or reserved by this client flow.
- Finish and closing states cancel recovery. Old channel events cannot act on
  the replacement. Unexpected dispatch failures offer recovery instead of being
  silently swallowed. Diagnostics contain only a reason label.

This does not distinguish people from nearby TV speech. Quiet-room and real
audio acceptance remain required. A missing playback-stop event is outside the
specific waits reproduced here.

## Validation

- Thirteen new regression cases cover terminal empty/final captions, echo versus
  real answers, missing input/caption events, connected-call replacement,
  managed session/deadline continuity, continued speech, normal legacy
  completion, late audible and legacy replies, active request timeout, and Finish.
- The turn-budget and managed-client suites pass all 108 tests together. The
  additional delayed-legacy regression failed before the review correction.
- The broader `npm --prefix app run test:voice` suite and app build pass.
- Native Safari local fixture: a missing input transcript produced the recovery
  message and Reconnect button. Reconnect restored Live interview, retained the
  captured answer, and kept the countdown. This used simulated media and a
  simulated account, with no real microphone, provider call, or credit.

To reproduce the local visual check:

```sh
VOICE_FIXTURE_PORT=8780 node app/tests/ui/voice-audio-fixture.cjs
```

Open `http://127.0.0.1:8780/voice-interview.html?stall=1`, choose a role, click
**Check audio**, then **I can hear you. Start interview**. After the injected
answer and reply delay, select **Reconnect**. The yellow fixture notice must
remain visible throughout this synthetic check.

## November 7 development acceptance update

On development revision `6f01a110d5209d7baf5131b1eab2400412d49e70`, the
recorded quiet Safari interview completed naturally, saved and reopened its
report, used one credit and closed the provider call. The owner confirmed all
questions and the closing played clearly.

The separate low-volume background-speech and Audio help exercise retained
the captured answer and resumed after Enable audio. The reported silence
followed a second manual Audio help click. It exposed confusing live-recovery
controls and a replay that selected an earlier question. See
[the Audio help correction](voice-audio-help-acceptance-20261107.md).

Real device replacement and network reconnect are still unverified. The older
independent uncertain provider-closure record remains open. These observations
do not establish full release acceptance. The new correction requires
development CI and deployed verification before QA (`develop`); production
(`main`) remains a separate promotion after QA acceptance.
