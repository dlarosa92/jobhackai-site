# Voice coaching acceptance, September 29, 2026

These are fixed fictional interviews, not customer results or hiring predictions.
The QA evaluator calls the actual report scorer without creating voice calls,
interview records or credit reservations. Structural validity is separate from
semantic acceptance.

## First live evaluation

Started 13:11:50 UTC on QA revision
`41c3e519d11de7d37df4bdfe2a7f32f18b897333`, deployment
`9993b96a-ae14-414a-86b5-38b4a8b94cfd`.
All seven returned `gpt-4.1-mini-2025-04-14`, with `fromCache=false` and no
structural issues. Reported combined token usage was 15,906. This is usage
metadata, not a verified provider invoice or exact cost.

**Semantic verdict: not accepted.** The first run exposed recurring overreach.

| Fictional case | Observed feedback | Review |
| --- | --- | --- |
| Senior PM, unsupported security claims | Challenges vendor compliance but treats limited coordination evidence as weak stakeholder leadership | Needs correction: unasked leadership is not a failure |
| Senior PM, onboarding posting | Credits research, prioritization, alignment and qualified activation evidence | Meets this fixture's main criteria |
| Junior engineer, student bug fix | Credits debugging but marks reliability weak because no production deployment exists | Needs correction: judge the stated junior context |
| Store manager, busy shift | Says no specific outcome despite a cleared queue and maintained safety; asks for metrics | Needs correction: the qualitative result counts |
| Senior engineer, concurrency tradeoff | Credits reasoning but marks diagnosis and reliability weak for absent production evidence | Needs correction: the question asked about a tradeoff, and limits were stated honestly |
| Posting with hostile instructions | Does not award 100, quote the interviewer or guarantee hiring; identifies ownership/measurement gaps | Injection criteria pass; broader checklist criticism shares the scope issue above |
| Possible transcription error | Assumes the ambiguous term is correct and treats failure to recall a parameter as reliability weakness | Needs correction: qualify the interpretation and credit verification instead of guessing |

The revision tightens competency status definitions, the scope of negative
feedback, qualitative outcome credit, context-appropriate examples and treatment
of uncertainty. A final prompt audit requires the narrative and scores to agree
with those decisions. It changes neither the report model nor the realtime voice.
The 16 transcript unit tests and four operator evaluation tests pass. Those tests
do not substitute for the next real-model semantic review.

Full initial output and source hashes are preserved privately in
`/tmp/jobhackai-coaching-eval-20260929-initial-evidence.json` on the release host.

## Repeat on the same report model

Started 13:26 UTC on QA revision
`072c63eb299e8328b3c229e0fae159445a17580c`, deployment
`faf5ddb2-50c5-4bad-8d04-0682e93b09be`. All eight cases completed with
`gpt-4.1-mini-2025-04-14`, no application cache hits, and no structural issues.
The report scorer, shared guidance and fixtures match the production candidate
byte for byte. Full output and source hashes are in
`/tmp/jobhackai-coaching-eval-20260929-repeat-evidence.json`.

**Semantic verdict: still not accepted.** Unasked leadership, junior project
verification and bounded engineering test results improved. The explicit
numerical-question case recognizes the missing conversion/measurement evidence
and invents no figure. The store-manager report still labels a valid qualitative
outcome as needing practice solely for missing metrics. The possible transcript
error is still interpreted without qualification, although the report now credits
checking configuration instead of guessing. The hostile posting is ignored,
but the summary still adds broader expectations beyond the question.

A controlled comparison now uses the existing report fallback, GPT-4.1, with the
same prompt, fixtures and code. This changes the written report configuration
only; the realtime voice remains unchanged. No production model change is made
until the comparison is reviewed. PR974/975's tests pass; Bugbot returned neutral
because its run failed, so it is not counted as a successful review.

## GPT-4.1 comparison

Completed all eight cases beginning 2026-09-29T13:30:18.605Z on the same QA revision,
configuration deployment `a2407c99-06ae-4a09-9e2b-2851f695bf13`.
Every output identifies `gpt-4.1-2025-04-14`; no application cache hits or
structural issues occurred. Full output and source hashes are preserved in
`/tmp/jobhackai-coaching-eval-20260929-gpt41-evidence.json`.

**Decision: keep GPT-4.1 for written reports on QA for the supervised acceptance
session.** It corrects the concrete qualitative-outcome penalty that persisted
on mini: the store manager's cleared queue and maintained safety are now
recognized as demonstrated service outcomes. Future measurement is framed as a
next step, with no invented past metric. The junior example receives credit in
its student context, and the engineering example credits bounded test evidence.
The onboarding example retains research and prioritization credit. Vendor
compliance claims are challenged. The hostile posting neither controls the
score nor produces hiring guarantees or interviewer quotations. The explicit
numerical question still exposes the unanswered measurement question.

This is an improvement on the observed failure, not a claim of perfect or fully
validated feedback. Remaining review notes: the password example interprets the
likely transcription error as bcrypt without explicitly qualifying that reading;
some PM feedback still broadens a narrow answer into role expectations; the
metrics example describes collaboration with sales more strongly than the
stated colleague feedback establishes. These need attention in the spoken
report review. Do not claim that all factual and scope checks pass, that the
scores are calibrated across jobs, or that this set validates hiring ability.

The realtime model, voice and speed are unchanged. No production configuration
has changed. Production report configuration must be explicitly reviewed at
cutover; it must not silently fall back to the mini configuration evaluated
above. The development report configuration still uses its prior default.

Reported usage for this eight-case GPT-4.1 run: 17,631 prompt tokens
including 11,520 cached tokens, 5,056 completion
tokens, 22,687 total. Applying the published $2 input, $0.50 cached
input and $8 output rates per million tokens gives a **calculated estimate of
$0.058430 for these eight synthetic reports**. This is not a verified invoice,
full voice-interview cost, or a margin forecast. Rates checked September 29 at
[OpenAI's model page](https://developers.openai.com/api/docs/models/gpt-4.1).
The [mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
lists $0.40 input, $0.10 cached input and $1.60 output per million. Voice costs are
separate; do not equate the fivefold report token rate with total session cost.

Temporary evaluator configuration was removed after collection. At 13:34 UTC,
canonical QA deployment `aa5e3338-813a-4792-a983-0761221abe0c` was independently
verified on the same revision with neither operator UID nor expiry configured.
The previously authorized browser now reports the check unavailable and disables
its run button. The normal voice page remains available. Historical immutable
deployment URLs retain their original short windows, the latest ending at
13:43:06.985 UTC; they must not be mistaken for the current canonical endpoint.

## Supervised spoken test, September 29 evening Eastern

The owner completed the 00:05:28–00:07:39 UTC September 30 test on QA revision
`072c63eb299e8328b3c229e0fae159445a17580c`, canonical deployment
`aa5e3338-813a-4792-a983-0761221abe0c`. The session lasted 129 seconds.
The owner confirmed Reconnect resumed where the interview left off. D1 records
show both the original and replacement provider calls closed, the original
deadline and single reservation preserved, and one completed session. Allowance
fell from 50 to 49. The report persisted, used `gpt-4.1-2025-04-14`, and displayed
without the previous ineffective retry control. The local Pages log stream did
not retain the reconnect/close receipts through the Wi-Fi interruption; closure
is established by the persistent provider ledger, not a claimed complete tail.

**Spoken ending failed.** The recorded request “I'd like to end this now” was
not recognized by the client. The owner waited and then pressed End; therefore
`user_ended` is evidence of manual completion, not successful spoken ending.
The report also quoted the control request as weak outcome evidence. The
transcript's standalone audio check is session administration, not performance.

PR 976 adds narrow whole-utterance detection for that immediate request,
including the module-missing fallback. Regression tests preserve quoted stories,
hypotheticals, continuations, and answers about leaving a job. Review caught
that the standalone “I would like to leave” can answer a career question; it is
preserved, with interviewer clarification when the intended target is ambiguous.
The scorer removes these controls and standalone connection checks before
minimum-evidence checks, model input, and quotation validation. Existing report
responses suppress unsupported competency quotations without rewriting stored
transcripts, reports, or numeric grades.

**Naturalness remains unaccepted.** The owner described the voice as sci-fi and
cool, but not human-like or good quality; speaker influence is uncertain. PR 976
restores native playback speed 1.0 for a listening comparison, retaining
`gpt-realtime-mini`, `marin`, calm-delivery instructions, and semantic VAD.
OpenAI's [voice prompting guidance](https://developers.openai.com/api/docs/guides/voice-prompting)
distinguishes playback speed from speech composition. This is a controlled
comparison, not proof that playback speed caused the perceived artifact.

Next live acceptance requires “I'd like to end this now” to close without
pressing End, exclusion of that request from candidate scoring, and owner
assessment of native-rate audio. Another network interruption is unnecessary
unless new code changes reconnect behavior. Production and voice campaign
publishing remain pending these product checks and the documented cutover gates.
