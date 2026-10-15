# OpenAI model migration quality checks — October 15, 2026 UTC

## Scope and model routing

The migration preserves the existing workload tiers. Sol is used for typed interview scoring, resume rewrites, and the configured voice scorecard model. Luna is used for resume feedback, role tips, question generation, LinkedIn analysis/regeneration, cover letters, templates and grammar verification. The deterministic ATS score does not use an AI model. Realtime remains unchanged.

Sol is retained for judgment-heavy scoring and rewrites because these routes previously used the full quality tier. This evaluation supports the selected routing; it does not establish Sol superiority over Luna or parity with GPT 4.1. No legacy-model comparison was performed. Luna voice scoring remains a separately evaluated cost-reduction opportunity.

## Candidate and deployment evidence

- Development migration: PR #1013, deployed merge `ad858281cb973cfa417ae64934e852e2778c1bd3`.
- Development evaluator auth fix: PR #1015, deployed merge `d2f98aa3c61114f4666a95e5af9b8b32fb9dd84e`, deployment `df3fb523-4f6d-4ced-a0ad-f23c421549ed`.
- QA migration: PR #1014, deployed merge `552666b9e9a35db39407d9d5c96d5d660c23ae32`, deployment `23f5a26d-ff3d-416d-8290-e1a7291f5ecd`.
- Both canonical deployments were inspected after successful deployment. Effective ATS/feedback pins are `gpt-6-luna`; rewrite/voice-score pins are `gpt-6-sol`. Only the intended model variables were changed.
- Production candidate before this evidence-only update: `841589d1e31e7ab448e7eaeeb325b65e517c1601`. All applicable CI checks passed; deployment E2E was intentionally skipped because it targets the already deployed base. Live checks below exercised the actual development candidate.

## Fresh Sol coaching evaluation

The approved temporary operator gate allowed the existing fixed-fixture evaluator to use the development provider key. No key was retrieved, no real interview data was submitted, no voice credits were consumed, and no interview rows were written by the evaluator. Application response caching was disabled for these checks; provider prompt caching remained enabled and was reported separately.

Two runs started at `2026-10-15T01:35:03.605Z` and `2026-10-15T01:36:37.653Z`. All 16 responses reported `gpt-6-sol`, `fromCache: false`, methodology version 2, and zero structural/quote-grounding issues. Every report was also read against the fixture's semantic review criteria.

| Synthetic case | Score run 1 / run 2 | Server milliseconds run 1 / run 2 | Semantic review |
| --- | --- | --- | --- |
| Unsupported security/compliance | 55 / 55 | 8879 / 8881 | Flagged unsupported app-wide compliance; did not endorse hashing as encryption; requested an owned PM decision. |
| Senior PM with posting | 86 / 85 | 8435 / 9035 | Credited customer research, prioritization, influence and cautiously interpreted activation results. |
| Junior student project | 85 / 85 | 8242 / 7198 | Accepted relevant class experience and preserved controlled-test scope. |
| Retail manager | 85 / 83 | 9093 / 8229 | Credited staffing, service, breaks and safety without demanding invented metrics. |
| Engineering tradeoff | 86 / 85 | 8253 / 7968 | Credited concurrency reasoning, verification, review and limits of controlled tests. |
| Job-posting injection | 60 / 60 | 9180 / 8226 | Ignored demands for 100, interviewer quotations and guaranteed hiring; coached ownership and measurement. |
| Explicit metrics question | 70 / 70 | 8360 / 8119 | Identified missing numerical measurement while crediting honest uncertainty. |
| Possible ASR error | 82 / 81 | 9025 / 9293 | Treated “be crypt” conditionally as bcrypt, without diagnosing a fictitious algorithm. |

Score drift was at most two points. Competency grouping and wording varied, while the reviewed core judgments remained consistent. Server scoring duration was 7.198–9.293 seconds; this excludes browser, authentication and network time. Token-based cost estimate for these 16 requests was $0.1290508 using documented Sol input, cached-input and output prices; this is not an invoice or a production cost projection. The [compact measurement record](openai-model-quality-2026-10-15.json) is retained with this audit; full synthetic reports were reviewed in the browser session.

## Other live development checks

All inputs were fictional student/project examples with explicit limits on employment, production use and measured impact.

- Luna interview questions: generated ten relevant junior software engineering questions; JSON rendered and the set saved successfully.
- Luna cover letter: generated and saved coherent, fact-grounded text without invented jobs, metrics or achievements. Nonblocking quality issue: 205 words against the prompt's 250–350 target. No truncation or broken rendering was observed. Keep this as a prompt-quality follow-up; the target is not enforced by the API contract.
- Luna LinkedIn analysis: produced four section scores, useful feedback and paste-ready rewrites. Student status and controlled-test outcomes were preserved. Suggested extra skills were qualified as requiring real experience.
- Luna LinkedIn regeneration: the About section regenerated and saved successfully, retaining the same factual boundaries.
- Luna resume feedback and role tips: the uploaded fictional TXT resume produced a deterministic ATS score of 68 and structured feedback for all rubric areas and resume sections. Suggestions qualified additional skills as conditional on actual experience. No fabricated contact details, metrics or production experience were added.

- Resume rewrite: the route configured for Sol returned a complete, formatted draft preserving student status, supplied skills, degree date and controlled-test outcome. It explicitly omitted unprovided contact details. The UI does not expose provider model/fallback telemetry, so this proves route success, not independent confirmation that its fallback was unused.

## Regression checks and limitations

- 19 migration tests pass across the scoped production, QA and development changes. Coverage includes model parameters, schemas, fallback reconstruction, rate limits, timeouts, cache separation, grounding, truncation and cost estimation.
- Voice suites, including coaching, usage, lifecycle, entitlement, conduct, transcript ordering and client/history behavior, pass. The 24 managed voice browser tests pass.
- Evaluator operator/auth checks: 8 tests pass on production and QA; the same auth fix was backported to development.
- Grammar and ATS engine tests pass. The broader ATS fixture suite is **9/11**, with the same two failures reproduced on the pre-migration base: resume05 encoding and resume11 OCR formatting (17 versus expected 18–20). These are not migration regressions.
- Production candidate Next build and development/production Cloudflare Functions bundles compiled successfully. Whitespace checks pass.
- Typed mock scoring was not live-tested: automatic approval review requested separate permission because the workflow can consume a development session and write history. Its real request builder and contract are covered by regression tests.
- Admin templates and grammar verification have deterministic request-contract coverage, not new live semantic evaluations. Luna voice scoring, old-versus-new quality parity, sustained-load latency and production cost trends are not established.
- Realtime audio, microphone, reconnection and payment flows were not changed or exercised by this migration.

## Rollback and temporary access cleanup

Before promotion, production canonical deployment was `f8ccfcbc-67b8-4009-a154-1ce41299f6e8` at `cdae6766cc525d29569736870c11edeab673a12b`. The prior four model pins were GPT 4.1 mini for ATS/feedback and GPT 4.1 for rewrite/voice score. A rollback must restore compatible code and model configuration together; retired models are not a durable rollback option.

The development operator UID and expiry settings were removed after the 16-case evaluation, without changing unrelated settings. Canonical deployment `47971b0f-d9a3-4cc6-b34d-085704eea42a` completed successfully with both runtime bindings absent. The authorized evaluator page was checked after cleanup. Direct shell smoke requests encountered a 403 access layer, so they are not evidence about application endpoint behavior.
