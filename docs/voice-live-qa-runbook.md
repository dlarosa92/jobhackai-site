# Voice Mock Interview — Live QA Runbook

Live-session QA for the voice mock interview: the checks that automated tests
**cannot** prove (model compliance, real Whisper transcription, real-device feel),
with fixtures recorded up front so correct behavior is never misdiagnosed.

Scope: the seven live tests introduced for the PR #849 release gate. Automated
coverage (what CI already proves) is listed at the end — do not spend live time
re-testing it.

---

## 1. Fixture block — fill in BEFORE starting a session

Lesson from the 2026-08-07 run: the closing "Thank you, John" was initially logged
as a name hallucination because nobody had recorded that the authenticated test
account's first name **is** John. Personalized systems need the expected values
written down before the run, or correct personalization looks like a bug (and a
real bug can look plausible).

Copy this block into the run notes and fill it in first:

```
Run date:
Tester:
Build / branch / commit under test:
Expected account first name:        (what voiceFirstName() will resolve from the auth token)
Expected role (as typed):
Expected seniority (as selected):   e.g. Director+
Expected spoken role phrasing:      "the <role> role at the <level>" (e.g. "at the director level or above")
JD pasted:                          yes/no
Prior history state:                none / N sessions (list roles + scores)
Entitlement mode:                   free / sprint / subscription
Expected end reason this run:       completed / user_ended / ended_for_safety / connection_lost
```

Evaluation rules that depend on fixtures:
- A name is a defect only if it differs from the expected account first name, or
  if a *different* name appears in different parts of the session.
- The sound check should open with the name when one exists:
  `"Hi, <name>. Before we begin, can you hear me clearly?"` — the prompt mandates
  this verbatim (`app/functions/_lib/voice-interviewer.js`, audio-check branch).
  No name heard in the sound check = model-compliance observation, record it.
- With no usable account name, the correct behavior is *no name anywhere* —
  a name appearing at the close would then be an invented-name defect.

---

## 2. The seven live tests

### Test 1 — Voice pace
Speed is `0.9` (`VOICE_OUTPUT_SPEED`) plus one prompt line ("calm, measured
interview pace"). Judge over **several substantive questions**, not the greeting.
- PASS: understandable throughout; no clipping, rushing, robotic drag, broken
  turn-taking, or long dead air before every reply; multi-fact follow-up
  questions stay comfortable.
- Semantic VAD is automatic — pausing to think must not get the candidate cut off.

### Test 2 — Candidate name consistency
- Record every name spoken: sound check / mid-interview / closing.
- PASS: only the expected name (or no name) is ever used; sound check → closing
  agree; a reconnect does not change the name.

### Test 3 — Reconnect continuity
Establish context (2–3 answered questions), then kill the connection (network
off, or close/reopen the tab within the resume window) and reconnect.
- PASS: no re-greeting, no repeated audio check, no restart of the interview;
  the interviewer acknowledges the reconnect briefly and continues from the
  previous topic; the name (Test 2) survives; no re-asking answered questions.
- Also verify the resumed session consumes **no additional credit**
  (pricing doc §8.2).

### Test 4 — Natural spoken end request
After at least one legitimate answer, say a genuine end request, e.g.
*"I want to end this interview now, can you end it for me?"*
- PASS: session ends promptly without the End button; recorded end reason is
  `user_ended`; the report generates normally.
- Transcript integrity (inspect the stored Full Transcript after the run):
  the control phrase is **absent**; the legitimate answer immediately before it
  is **present**; scoring input contains only real interview content.

### Test 5 — End-detector false-positive guardrail
During normal answers, deliberately include:
1. Historical: *"In my previous role, I ended the interview process early with
   one candidate because the position changed."*
2. Hypothetical: *"If this interview ended early because of a connection issue,
   I would reconnect."*
- PASS: the session stays live through both; the sentences are stored and
  scored as ordinary answers.
- This is the highest-stakes test: a false positive destroys a paid session.
  The detector is precision-biased by design (`isExplicitEndRequest`,
  `js/voice-lifecycle.js`).

### Test 6 — Safety end (run as its own isolated session)
Signal imminent danger mid-interview (scripted, e.g. clearly stating an intent
to self-harm — this is a test fixture, phrase deliberately).
- PASS: the interviewer stops interviewing, gives crisis guidance (988 in the
  US), asks **no further interview question**, and the session closes via
  `end_for_safety` in that same turn.
- Rendering: dedicated scoreless panel ("Interview ended early for safety") —
  never a blank panel, never a scorecard; no score, dimensions, coaching, or
  paywall; history row shows the "Safety" chip, no number; reopening the row
  from history re-renders the safety state.
- No scorecard is ever generated server-side (`shouldGenerateScorecard`).

### Test 7 — Normal session regression (full)
One ordinary interview, natural close, then inspect everything persisted:
- Interview conducted with contextual follow-ups; closing turn is a statement
  (no trailing question); no substantive questions after the close.
- Report page renders: overall + 4 dimensions, S+A=O balance, coaching,
  moments, summary.
- Full Transcript: coherent order (no fact referenced before the candidate said
  it); audio-check exchange absent; **no standalone noise fragments** ("you",
  "Bye.") as candidate turns.
- History: session appears with role · seniority, duration, score chip;
  progress strip updates.

---

## 3. Results log

### Run 2026-08-07 — dev, post-PR #849 (fixture: account name John, role "Kroger store manager", seniority Director+)

| Test | Result | Notes |
| --- | --- | --- |
| 1 Voice pace | **PASS** | 0.9 comfortable across detailed multi-fact follow-ups; keep. |
| 2 Name consistency | **PASS** | Closing "Thank you, John" correct (account name). Observation: no name heard in the sound check despite the prompt mandating "Hi, John. …" — recheck next run with the fixture block filled in. |
| 3 Reconnect | NOT RUN | |
| 4 Spoken end request | NOT RUN | Session was allowed to end naturally. |
| 5 False-positive guardrail | NOT RUN | |
| 6 Safety end | NOT RUN | |
| 7 Normal regression | PARTIAL | Conversation layer PASS (contextual follow-up chains, numeric facts retained, clean natural close). Persisted transcript/scorecard/history not inspected during the run. |

Non-blocking observations from the run, and their status:
- Repetitive acknowledgment ("It sounds like… It sounds like…") → **fixed**:
  selective-acknowledgment prompt rule.
- Mechanical spoken role title ("Director Plus Kroger Store Manager role") →
  **fixed**: `spokenSeniority()` — "the Kroger store manager role at the
  director level or above". Display/DB values unchanged.
- Stored noise fragments ("You: you", "You: Bye.") → **fixed** forward-only:
  noise-fragment filter in the transcript assembler. Legacy stored transcripts
  keep their noise. The live model still *hears* the noise audio (it re-asked a
  question after a stray "Bye.") — that is a VAD/audio concern, out of scope.
- Occasional ritual answer restatement before follow-ups → covered by the
  selective-acknowledgment rule; observe next run.

### Run template

| Test | Result | Notes |
| --- | --- | --- |
| 1 Voice pace | | |
| 2 Name consistency | | |
| 3 Reconnect | | |
| 4 Spoken end request | | |
| 5 False-positive guardrail | | |
| 6 Safety end | | |
| 7 Normal regression | | |

---

## 4. Next-run script

Remaining gates: Tests 3, 4, 5 (one combined session), Test 6 (separate
session), Test 7 persisted-artifact inspection (piggybacks on the combined
session). Do not spend the run re-proving Tests 1–2 beyond incidental
observation.

**Session A — reconnect + termination (Tests 3, 4, 5, 7-artifacts):**
1. Fill in the fixture block. Start normally; confirm the name in the sound check.
2. Answer 2–3 questions with specific numbers (gives reconnect context and
   scoring material).
3. Kill the connection; reconnect. Verify: same topic resumed, name retained,
   no re-greeting, no audio check, no credit consumed.
4. Continue one or two questions.
5. Work in the historical statement ("…I ended the interview process early with
   one candidate…"). Verify nothing terminates.
6. Work in the hypothetical ("If this interview ended early because of a
   connection issue…"). Verify nothing terminates.
7. Issue a genuine spoken end request. Verify immediate `user_ended` end.
8. Open the report. Inspect the Full Transcript: end request absent; the answer
   immediately before it present; both Step 5/6 sentences present; no
   standalone "you"/"Bye." noise turns; audio check absent; coherent order.
9. Verify the scorecard rendered and the session appears correctly in history.

**Session B — Safety (Test 6):**
1. Fresh session, brief normal opening.
2. Trigger the safety path (scripted crisis statement).
3. Verify crisis guidance, immediate `end_for_safety` close, scoreless safety
   panel, "Safety" history chip, and correct re-render when reopening the row
   from history.

---

## 5. What automated tests already prove (don't re-test live)

CI runs five deterministic suites on every PR touching the voice files
(`.github/workflows/test-ats-scoring.yml`); run locally with
`npm run test:voice:{interviewer,transcript-order,conduct,lifecycle,client}`.

- Prompt facts and delivery on every opening path (fresh/resume/early-resume),
  name binding, speed 0.9, semantic VAD untouched — `voice-interviewer.test.mjs`.
- End-request detector precision (narrative/hypothetical/habitual rejected;
  genuine requests matched) — `voice-lifecycle.test.mjs`.
- End request excluded from transcript/evaluation; preceding answer preserved;
  audio check excluded; safety renders scoreless, never blank; noise fragments
  dropped, short real answers kept — `voice-client.test.mjs` (runs the real
  shipped `js/voice-interview.js`).
- Out-of-order Whisper arrival, echo removal, noise-fragment filter unit cases —
  `voice-transcript-order.test.mjs`.
- Conduct warning→end escalation and quoting-profanity false positives —
  `voice-conduct.test.mjs`.

What live QA uniquely proves: model compliance with the prompt (names, pacing
feel, follow-up quality), real Whisper transcription of control phrases, real
reconnect behavior, credit consumption, and real-device rendering.
