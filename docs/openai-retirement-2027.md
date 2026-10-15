# OpenAI text model retirement migration

Follow-up implementation and live quality evidence: [October 15 evaluation](openai-model-quality-2026-10-15.md). The deployment and validation sections below preserve the initial audit state.

Audit date: October 14, 2026. Repository base: `cdae6766cc525d29569736870c11edeab673a12b` on `main`.

The official [deprecation notice](https://developers.openai.com/api/docs/deprecations) confirms January 14, 2027 retirement of GPT 4o, GPT 4o mini, GPT 4.1 and GPT 4.1 mini, including the listed snapshots. It recommends `gpt-6-luna`. [PR 778](https://github.com/dlarosa92/jobhackai-site/pull/778), merged April 5, migrated the prior defaults; it does not satisfy this new deadline. No overlapping open migration PR was found at audit time.

## Candidate changes and rationale

Economical text paths use `gpt-6-luna`. Higher quality paths and the voice escalation fallback use `gpt-6-sol`, preserving the previous routing roles. Sol is a supported candidate rather than a demonstrated coaching quality improvement. Both candidates still require application evaluation and account access verification.

The [Luna specification](https://developers.openai.com/api/docs/models/gpt-6-luna), [Sol specification](https://developers.openai.com/api/docs/models/gpt-6-sol), [migration guidance](https://developers.openai.com/api/docs/guides/latest-model), and [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) establish the request contracts. Both candidates support Chat Completions, structured output, and reasoning effort `none`. Requests explicitly select `none` to retain the existing nonreasoning workload, temperatures and small output budgets. `max_completion_tokens` replaces `max_tokens` for these candidates. This avoids the default medium reasoning consuming output budgets, especially grammar's 20 token response.

The API endpoint, prompts, JSON schemas, authentication and retry counts remain unchanged. Template generation now has a 1,200 token cap. Voice rejects a response marked `length` even if its text happens to parse. Grammar cache keys include the selected model so a migration does not reuse the old model's verdict. Explicit overrides remain authoritative, including old models during staged validation. No retiring overrides are silently remapped, and arbitrary alternative reasoning models are not claimed compatible with the legacy parameter path.

## Executable integration inventory

Paths are relative to `app/functions` unless otherwise stated. Luna and Sol below mean the exact model IDs above. Every listed old mini default becomes Luna; every listed old GPT 4.1 full default becomes Sol.

| Route or entry point | Implementation | Previous default | Candidate default / fallback | Model override |
| :--- | :--- | :--- | :--- | :--- |
| `/api/voice/session/[id]/complete`, `/api/voice/qa-coaching`, local coaching eval | `_lib/voice-scorecard.js` | GPT 4.1 mini / GPT 4.1 | Luna / Sol | `OPENAI_MODEL_VOICE_SCORE` |
| `/api/mock-interview/score` | `api/mock-interview/score.js` | GPT 4.1 | Sol / none | `OPENAI_MODEL_MI` |
| `/api/mock-interview/generate-questions` | `api/mock-interview/generate-questions.js` | GPT 4.1 mini | Luna / none | `OPENAI_MODEL_MI` |
| `/api/interview-questions/generate` | `api/interview-questions/generate.js` | GPT 4.1 mini | Luna / none | `OPENAI_MODEL_IQ` |
| `/api/resume-feedback` | `_lib/openai-client.js` | GPT 4.1 mini | Luna / none | `OPENAI_MODEL_FEEDBACK` |
| `/api/role-tips`, including cache metadata | `_lib/openai-client.js`, `api/role-tips.js` | GPT 4.1 mini | Luna / none | `OPENAI_MODEL_FEEDBACK` |
| `/api/resume-rewrite` | `_lib/openai-client.js` | GPT 4.1 / GPT 4.1 mini | Sol / Luna | `OPENAI_MODEL_REWRITE` |
| `/api/linkedin/analyze` | `api/linkedin/analyze.js` | GPT 4.1 mini | Luna / Luna | `OPENAI_MODEL_LINKEDIN_ANALYZE` |
| `/api/linkedin/regenerate` | `api/linkedin/regenerate.js` | GPT 4.1 mini | Luna / Luna | `OPENAI_MODEL_LINKEDIN_REGENERATE` |
| `/api/cover-letter/generate` | `api/cover-letter/generate.js` | GPT 4.1 mini | Luna / Luna | None |
| `/api/admin/generate-role-template` | `_lib/openai-template-generator.js` | GPT 4.1 mini | Luna / none | None |
| Grammar verification utility | `_lib/grammar-ai-check.js` via `_lib/hybrid-grammar-scoring.js` | GPT 4.1 mini | Luna / none | `OPENAI_MODEL_GRAMMAR` |
| Nonproduction `/api/test-openai` | `api/test-openai.js` | GPT 4.1 mini | Luna / none | `OPENAI_MODEL_ATS` |
| Shared `callOpenAI` default | `_lib/openai-client.js` | GPT 4.1 mini | Luna / caller supplied | Caller supplied |
| Root `functions/api/linkedin/analyze.js`, `regenerate.js`, `cover-letter/generate.js` | Separate root API copies importing the shared client | GPT 4o mini | Luna / Luna | Same LinkedIn overrides; none for cover letter |
| Root `test-openai-direct.js` | Local executable diagnostic | GPT 4.1 mini and GPT 4.1 | Luna and Sol | Feedback and rewrite overrides |

The grammar utility is executable but the audit found no active endpoint importing the hybrid wrapper; do not equate its presence with current production traffic. The AI feedback call in `api/ats-score.js` is commented out. `OPENAI_MODEL_ATS` controls the diagnostic, not the deterministic ATS scorer. Root API copies are migrated defensively; route reachability in each Pages bundle was not exercised. No other text request builders were found in executable JS, TS, MJS or shell sources. Historical documents, pricing rows and recorded test responses retain old model names deliberately.

Fallback behavior remains bounded by the existing retry count: 429 retries the same model; other HTTP, network and timeout failures can switch once to a distinct configured fallback. A fallback equal to the primary is not a distinct model attempt. Thus a production voice override to Sol makes its hardcoded Sol fallback the same model, just as the prior full GPT 4.1 override did. Malformed or refused content does not trigger a new semantic fallback policy. Short candidate transcripts still produce the local unscored report without an API call.

Token and temperature overrides are retained: `OPENAI_MAX_TOKENS_ATS_TIER1`, `OPENAI_MAX_TOKENS_ATS`, `OPENAI_MAX_TOKENS_REWRITE`, `OPENAI_MAX_TOKENS_LINKEDIN_ANALYZE`, `OPENAI_MAX_TOKENS_LINKEDIN_REGENERATE`, `OPENAI_TEMPERATURE_SCORING`, `OPENAI_TEMPERATURE_REWRITE`, and the two corresponding LinkedIn temperature variables. Their deployed values were not inspected. Other fixed output caps remain voice 2,400, mock scoring 3,000, mock questions 1,500, interview questions 2,000, cover letter 800 and grammar 20.

## Initial deployment audit, before the authorized rollout

Cloudflare project settings and the canonical production deployment were read through the connector using a filter that returns only model settings. API credentials were not retrieved. Production deployment `f8ccfcbc-67b8-4009-a154-1ce41299f6e8`, created October 14 at 17:11:54 UTC, identifies the audited repository base above.

| Setting | Production `jobhackai-app-prod` | QA `jobhackai-app-qa` | Development `jobhackai-app-dev` | Candidate value requiring separate rollout |
| :--- | :--- | :--- | :--- | :--- |
| `OPENAI_MODEL_ATS` | `gpt-4.1-mini` | `gpt-4.1-mini` | `gpt-4.1-mini` | `gpt-6-luna` |
| `OPENAI_MODEL_FEEDBACK` | `gpt-4.1-mini` | `gpt-4.1-mini` | `gpt-4.1-mini` | `gpt-6-luna` |
| `OPENAI_MODEL_REWRITE` | `gpt-4.1` | `gpt-4.1` | `gpt-4.1` | `gpt-6-sol` |
| `OPENAI_MODEL_VOICE_SCORE` | `gpt-4.1` | `gpt-4.1` | Absent | `gpt-6-sol` initially for production and QA; evaluate Luna separately |
| `OPENAI_MODEL_VOICE` | `gpt-realtime-mini` | Absent | Absent | Unchanged by this migration |

Other model overrides were absent in the inspected settings. QA and development commits differ from main; their settings do not prove that candidate code is deployed. The marketing project had no model overrides. No Worker deployment configuration or runtime request telemetry was inspected. A code merge alone leaves four retiring production pins in place.

Realtime modules, client secret requests, calls, managed interviews, transcription and model configuration are untouched. The official deprecation page separately lists `gpt-realtime-mini` retirement on January 20, 2027. That is a distinct followup, not a change bundled into this text migration.

## Cost implications

Standard short context USD per million tokens from the model specifications. Historical input/output rates are retained for comparison.

| Model | Input | Cached input | Output |
| :--- | ---: | ---: | ---: |
| GPT 4.1 mini | 0.40 | 0.10 | 1.60 |
| GPT 4.1 | 2.00 | 0.50 | 8.00 |
| GPT 6 Luna | 0.10 | 0.01 | 0.50 |
| GPT 6 Sol | 2.00 | 0.20 | 10.00 |

For an illustrative 2,000 input and 1,000 output tokens without cache, the old mini costs $0.0024 versus Luna $0.0007, about 71% lower. The old full model costs $0.012 versus Sol $0.014, about 17% higher. These are fixed token comparisons, not measured savings or production volume estimates. Sol output rates are 25% higher, so the quality tier is an explicit tradeoff.

The shared estimator now recognizes candidate models, charges cached input rather than treating it as free, supports dated snapshots, and returns null for unknown models or missing usage. Evaluation reports use the same rates. Estimates exclude cache write premiums, long context, service tier and regional adjustments and are not invoices. Actual total usage and fallback frequency must be measured.

## Initial validation and release gates

Completed locally on Node 24.19.0:

1. `npm run test:openai:migration`: 19 tests passed. Covers shared and direct request builders, strict schema preservation, actual question/scoring builders, legacy and modern overrides, fallback reconstruction, 429, network errors, timeouts, cache separation, truncation, empty and malformed voice output, grounding and costs. A source inventory guard prevents retiring text defaults returning outside historical pricing.
2. Existing voice coaching and usage suites: 18 tests passed, including candidate evidence, short transcripts, persistence and cached usage provenance.
3. Existing voice transcript unit suite: 16 tests passed. These are deterministic harness checks, not model quality results.
4. Existing grammar engine and ATS scoring suites passed. `git diff --check` passed.

The migration suite is wired into the ATS workflow and its path filters now include changed API and root copies. CI uses Node 18; the remote result must be checked independently. No complete app build or deployed endpoint smoke test was performed.

Live `app/tests/voice-coaching/run.mjs` exited with its documented missing key condition. No local OpenAI key or provisioning capability was available. Replacement access, actual JSON adherence, semantic coaching quality, latency and actual costs are therefore unverified. Mock tests cannot establish those properties. Do not merge or deploy on a claim of quality parity.

Before production rollout:

1. Deploy the reviewed candidate to development through the established branch promotion process. Update development model overrides only as an approved configuration step; a candidate branch alone does not replace the environment's retiring pins.
2. With a development provider key supplied privately, run `OPENAI_MODEL_VOICE_SCORE=gpt-6-sol npm run eval:voice:coaching` and separately evaluate `gpt-6-luna`. Preserve each output file before the next run. The harness records hashes of the scorecard, coaching prompt, client and model parameter module. The protected staging coaching page is an alternative only after the candidate is deployed and its operator gate is configured.
3. Review all eight current cases against their `reviewRequired` criteria: relevant competency evidence, quote fidelity, credit for sound answers, no invented weaknesses, unsupported experience or unasked metrics, and appropriate coaching. Compare repeat runs for material score or advice drift. Preserve the current GPT 4.1 result as a baseline while available. The older 100 case harness uses obsolete 5/10/85 bands and must not be treated as acceptance for methodology version 2.
4. Exercise feedback, role tips, rewrite, both question generators, mock scoring, LinkedIn analysis/regeneration, cover letter, admin templates and grammar in staging. Capture actual model, errors, truncation, latency, tokens and fallback frequency. Verify schema acceptance and provider access for both candidates.
5. Approve code promotion and the exact production model configuration separately. Preserve the current production voice quality tier initially by setting its override to Sol. After deployment, inspect the canonical deployment's effective model settings and successful request telemetry. Clear or distinguish cached results when evaluating a model switch; persisted historical scorecards are not regenerated by this PR.
6. Observe one release window. Before January 14, rollback can restore the previous code and configuration together if necessary. After retirement, rollback must use a validated supported model. Keep the separate Realtime deadline tracked outside this change.
