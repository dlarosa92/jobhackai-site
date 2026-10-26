# Voice topic progression and score eligibility

Candidate implementation, October 25, 2026. Based on dev0 revision
`19274e386c1562e3f46f30e8ccfedb7d2634bad9`. This document does not record
a deployment or final Voice QA acceptance.

## Problem and resulting behavior

A recorded development interview stayed on the opening example for seven
follow-ups, presumed inconsistent data after the candidate described consistent
data, and issued a numerical grade for a 165-second sample.

The browser now requests each interviewer response after a committed candidate
turn. It waits for `session.updated` to confirm semantic VAD with
`create_response: false` and `interrupt_response: true`. Semantic endpointing
and interruption remain enabled; their sensitivity and timing are unchanged.
See the [Realtime event reference](https://developers.openai.com/api/reference/resources/realtime/client-events#session.update)
and [manual response guidance](https://developers.openai.com/api/docs/guides/realtime-conversations#keep-vad-but-disable-automatic-responses).

The app allocates one main question and at most two follow-up opportunities per
topic, then requests a different example or competency. Three topics provide
up to nine question opportunities, followed by a final invitation and closing.
The existing near-deadline wrap-up takes precedence. Candidate answers, role,
level and job context remain in the conversation; the turn directive is an
additional system item, not a replacement for the interview/conduct rules.
Those control items are excluded from the saved transcript.

Requests, rather than possibly duplicated transcripts, spend the budget.
Interrupted requests also spend an opportunity. Duplicate commits and stale
completion events do not release another request. Reconnect preserves the
budget; an audio-check restart resets it. Configuration acknowledgement has an
eight-second deadline; a response has a 45-second generation deadline. Rejected
requests or expired deadlines save and close the attempt through the existing
connection-loss path. This does not introduce an extra refund policy.

The controller enforces the request sequence, not the semantics of generated
speech. A live model could still phrase a new-topic request as another probe.
Recorded listening acceptance remains necessary. A reconnect during an answer
can require the candidate to repeat it; pending requests are not replayed
automatically across connections.

## Feedback without a numerical score

The existing 200-character minimum now counts candidate speech without speaker
labels. Above that minimum, a limited sample can receive useful qualitative
feedback without a numerical grade. The initial evidence gate requires:

- At least 300 candidate words across unique answer blocks.
- At least three substantive answers of 40 words or more. Consecutive candidate
  transcription chunks are merged until an interviewer turn; exact duplicate
  answer blocks count once. Recognized session controls do not count.
- At least three grounded competency assessments after model generation.

These are conservative, provisional product thresholds, not validated score
calibration or a measure of hiring readiness. Neither elapsed time nor an
upgrade can make a limited sample eligible. The model receives a qualitative
schema when the transcript gate fails. The server also strips numeric fields
after generation and when serving feedback-only history/report responses.
Free and full views explain the limited sample while retaining their existing
access rules. Existing stored numerical reports are not silently regraded.

An offline replay of the recorded transcript found 232 candidate words and two
substantive answers. Given the same saved model output, the baseline retained
66; this implementation retained qualitative feedback with `overall: null`.
No new provider request was needed for that comparison. Private transcript and
recording files stay outside this repository.

## Validation

- 80 focused Node tests passed across turn-budget, score-evidence, client,
  managed-client, coaching and report suites.
- The existing aggregate `npm --prefix app run test:voice` passed: entitlement,
  lifecycle, conduct, prompt, client, history, transcript ordering, evaluation
  harness and reservation/race checks. The new suites are also included in the
  aggregate command and in CI.
- `npm --prefix app run build`, JavaScript syntax checks and `git diff --check`
  passed. The generated page loads the versioned turn-plan module and client.

Focused reproduction:

```sh
npm --prefix app run test:voice:turn-evidence
node --test app/functions/_lib/__tests__/voice-coaching.test.mjs \
  app/functions/_lib/__tests__/voice-session-report.test.mjs \
  app/functions/_lib/__tests__/voice-managed-client.test.mjs \
  app/functions/_lib/__tests__/voice-client.test.mjs
```

Before acceptance, review and deploy to development, verify the delivered app
and worker versions, then record an owner-led interview: audio-check repeat,
captions, third-question topic progression, barge-in, reconnect, manual Finish,
near-deadline wrap-up and natural closing. Check both feedback-only and eligible
reports. Confirm the provider call closes and exactly one history record is
saved. Existing production hold and remaining environment/acceptance gates
remain in effect. No human recording or provider session starts automatically.
