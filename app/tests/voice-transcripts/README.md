# Voice Interview Scorecard — Transcript Evaluation Harness

Local, opt-in evaluations that test whether the voice interview scorecard
(`app/functions/_lib/voice-scorecard.js`) evaluates completed interview
transcripts sensibly — especially JobHackAI's proprietary
**Situation + Action = Outcome (S + A = O)** formula.

These runs make **real OpenAI API calls**. They are deliberately NOT part
of any GitHub Actions workflow or PR gate.

## What this tests

- The exact production scoring path — `scoreVoiceTranscript()`, the same
  prompt, JSON schema, model selection, and parsing used by the DB-backed
  `generateAndStoreScorecard()` — invoked directly with a role, seniority,
  and transcript.
- **Range reasonableness, not exact scores.** Each fixture asserts wide
  bands for `overall`, `dimensions.structure` (which production scores BY
  the S+A=O formula), the `saoBalance` situation/action/outcome
  percentages, and (where relevant) `dimensions.roleFit`.
- **Semantic feedback expectations** via concept matching. Examples:
  - A candidate with measurable outcomes must NOT be told that no outcome
    was provided (`claims-no-outcome` is forbidden anywhere in feedback).
  - A candidate with only background + actions must get a low Outcome
    share in `saoBalance` and outcome-focused coaching.
  - An irrelevant answer must not receive a high `roleFit` score, and
    feedback must not praise its relevance.
- **Stability**: repeated runs of the same transcript should produce
  similar scores (variance is reported, not asserted).

## What this does NOT test

- Anything DB- or HTTP-related: session lifecycle, entitlements/gating,
  D1 persistence, partial-vs-full scorecard display, and the too-short
  fallback flow are untouched (the too-short path is unit-tested).
- Voice capture or realtime transcription quality — fixtures are
  already-transcribed text.
- The browser UI (no Playwright involved).
- Exact model scores — the model is non-deterministic; only ranges and
  semantic expectations are validated.

## Running

Requires Node >= 22 and an OpenAI key:

```bash
export OPENAI_API_KEY=sk-...

npm run test:voice:transcripts:smoke      # 20 representative cases (~1 per archetype)
npm run test:voice:transcripts:full       # all 100 cases
npm run test:voice:transcripts:stability  # 10 cases x 3 runs, reports variance
npm run test:voice:transcripts:unit       # deterministic unit tests, no API calls
```

Optional: `OPENAI_MODEL_VOICE_SCORE` overrides the scoring model, exactly
like the production environment variable (default `gpt-4.1-mini`, with
`gpt-4.1` as production's fallback model).

Calls run at concurrency 3 with retries (exponential backoff) for
transient API failures. Reports (JSON + Markdown) are written to
`app/tests/voice-transcripts/reports/` (git-ignored).

Rough cost guide with the default gpt-4.1-mini: roughly $0.001–0.002 per
case — a smoke run is ~20 calls, a full run ~100, stability 30.

## The fixture dataset

`fixtures/transcripts.jsonl` — 100 cases in a balanced matrix of
**20 candidate behavior archetypes x 5 quality levels**
(excellent / good / average / weak / poor). Archetypes cover strong STAR
answers, weak/generic answers, missing outcomes, vagueness, excessive
background, excessive process detail, measurable results, conflicting
claims, short answers, rambling, senior leadership, technical deep-dives,
nervousness, irrelevance, team-credit ("we" answers), hypotheticals,
blaming, buzzwords, question-dodging, and a balanced baseline.

Each fixture contains:

- `id` (unique), `archetype`, `qualityLevel`
- `role`, `seniority`
- `transcript` — alternating interviewer/candidate turns (3 questions).
  Fixtures use readable `interviewer`/`candidate` speakers; the harness
  converts them to the production `assistant`/`user` format before scoring.
- `expectations`:
  - `overallScore`, `structureScore` (dimensions.structure, 0-100),
    `sao.{situation,action,outcome}` ranges on `saoBalance`, plus
    `roleFitScore` where the archetype demands it
  - `feedbackMustMention` — groups of concept IDs; at least one concept
    per group must appear in coaching-oriented feedback (saoCoaching,
    topImprovement, moment comments, summary)
  - `feedbackMustNotMention` — concept IDs that must appear nowhere
    (including topStrength)

The dataset is generated deterministically. To change it, edit
`fixtures/content-banks.mjs` (transcript text) or
`fixtures/archetypes.mjs` (composition plans + expectations), then:

```bash
node app/tests/voice-transcripts/fixtures/generate-fixtures.mjs
npm run test:voice:transcripts:unit   # validates the regenerated dataset
```

A unit test fails if `transcripts.jsonl` is out of sync with the
generator, so add cases through the generator (a new archetype entry
automatically produces all 5 quality levels; a new role or question goes
in the content banks).

Concept IDs and their matching patterns live in `lib/concepts.mjs`.

## Interpreting failures

Each failed case lists its failed checks:

- `overall-range` / `structure-range` / `rolefit-range` / `sao-range` —
  a score fell outside the fixture's expected band. One-off borderline
  misses can be model noise (compare with a stability run); consistent
  misses across a whole archetype indicate a scorecard behavior problem
  (e.g. Outcome share estimated high when no outcome was stated, or
  structure not actually scored by the S+A=O formula).
- `missing-concept` — coaching feedback never touched any concept in a
  required group (e.g. no specificity coaching for a vague candidate).
- `forbidden-concept` — feedback said something it must never say for
  that case (e.g. "no outcome provided" to a candidate who gave metrics).
- `api-error` — the call failed after retries; infrastructure, not scoring.

The Markdown report also shows average scores per expected quality level —
these should decrease from excellent to poor; inversions suggest the
scorecard is not discriminating quality.

Pass-rate expectations: ranges are intentionally forgiving, but this is an
LLM evaluation — occasional single-case flakiness is normal. Treat repeated
failures of the same case or category as real regressions, especially after
prompt changes.

## Baseline (first real smoke run, 2026-07-18, gpt-4.1-mini)

18/20 passed (90%), ~27k tokens, ~$0.019. Quality-level averages were
monotonic at the top (excellent 84.5 > good 70.8 > average 65.8); the
weak/poor tiers can invert in SMOKE runs because each smoke tier contains
different archetypes — use the FULL run to judge tier ordering.

Known genuine finding (expected to keep failing until the production
grading prompt is tightened in a separate change): `irrelevant--weak`
received `roleFit` 50 for a fully off-topic transcript (expected <= 40).
The scorecard grades irrelevant content up rather than down. Do not
"fix" this by loosening the fixture range.
