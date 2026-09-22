# Role-based feedback evaluation

Run `npm run test:voice:coaching` for deterministic candidate-only evidence,
quote grounding and report rendering checks. These do not prove model quality.

With the development OpenAI key provided privately in the process environment,
run `npm run eval:voice:coaching`. It calls the actual scoring path with seven
synthetic cases, the configured current scorecard model, and no microphone,
D1 writes or real candidate data. Never put the key in a tracked file or output.

Review every saved output at
`app/tests/voice-transcripts/reports/coaching-v2.json` against its `reviewRequired`
criterion. Structural passes are not semantic approval. Assess correctness,
role/level relevance, JD use, handling of unasked skills, useful next steps,
quote grounding and uncertainty. Inspect score consistency across contrasting
cases; do not demand exact numeric scores. Repeat failures after fixes.

The earlier voice-transcripts harness encodes legacy 5/10/85 score bands.
Those bands are not acceptance criteria for methodologyVersion=2. Its grounding
and other deterministic tests remain useful; do not describe its historical
score ranges as validation of this revised rubric.

Live reconnect, audio naturalness, consent, billing and usage are separate QA
acceptance checks. These synthetic reports do not establish hiring validity.
