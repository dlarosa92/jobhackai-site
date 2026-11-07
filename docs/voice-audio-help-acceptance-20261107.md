# Audio help recovery, November 7, 2026

## Observed behavior

During recorded Safari development testing, the owner selected Audio help a
second time before answering. That action intentionally paused new replies.
The next answer was captured and queued, then received a follow-up after
Enable audio. The report saved, one credit was used, and the provider call
closed normally. This was not an unexplained transport failure.

The interface nevertheless showed a hidden Start interview button, setup
wording and a thinking cue during the pause. The primary-button CSS overrode
the hidden attribute, and reply-wait timers still ran during the intentional
pause. One replay also repeated an older main question rather than the latest
displayed follow-up. The generic instruction did not anchor the exact question.

## Correction

- Honor the Start button's hidden attribute during an active interview.
- Explain the pause and Enable audio action consistently, use continue wording
  for the microphone, and retain captured answers without misleading waiting
  or connection-stall cues during the pause.
- Supply the exact displayed question to the replay instruction without
  advancing the topic budget or activating another interview.

## Validation and release boundary

Two regressions reproduced against the previous client and now pass. The
managed-client and diagnostics suites pass 86 tests, and the client suite
passes 103. A native Safari CSS fixture confirmed the Start button is hidden
during recovery and still visible during initial setup. That isolated visual
check is not a deployed interview retest.

The existing development deployment is PR #1165, revision
`6f01a110d5209d7baf5131b1eab2400412d49e70`. Quiet interview, report reopening
and setup audio acceptance passed there. This correction must pass development
CI and deployed verification before a scoped QA promotion. Live provider
replay still needs verification against the corrected candidate. QA and
production acceptance are not implied by the local tests.

Low-volume nearby speech was exercised. Loud/continuous noise, physical
microphone removal/replacement and network reconnect were not established by
that run. The independent older uncertain provider-closure hold remains open.
Raw recordings, private transcripts and account identifiers stay outside the
repository.
