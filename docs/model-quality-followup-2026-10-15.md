# Model quality follow-up — 2026-10-15

The original text-model migration was already deployed to development, QA, and production when this follow-up began. Live GitHub and Cloudflare checks confirmed production SHA `6657c76457a41c07cc85b4f77ccd72c8f2675600` and the four new model pins. This release fixes findings from the earlier quality review.

## Changes

- Cover letters use a 250–350 word validation with at most one length revision. A failed second draft is not saved. No fabricated credentials or numerical padding is allowed. The preview has an accessible live word count, which also updates when restoring or clearing drafts.
- LinkedIn recommendations preserve the original endorsement text verbatim in both analysis and regeneration. Paraphrased feedback cannot become a fabricated direct quotation or acquire invented attribution.
- Resume requests rely on existing server entitlements and cache handling, rather than consuming/restoring credits in browser localStorage. The page displays the separate lifetime new-resume ATS allowance alongside feedback usage. Server limits are unchanged.
- An operator-only text evaluator exercises fixed fictional profiles through the production generation functions. It requires an explicitly non-production environment, the approved Firebase UID, valid authentication, and an unexpired time window. It accepts no arbitrary prompts/models and writes no history or credits. Middleware also blocks its page/API in production.

## Live development evidence

Initial 55-case run started `2026-10-15T10:48:13.292Z` against deployed candidate `4bb28ea77b93050e7a9a99d82a4bf31282e4474b`. All requests returned usable responses without structural flags. Resume-feedback and role-tip results from this first run are excluded from final acceptance: the runner incorrectly supplied empty rule scores. PR #1017 corrects it to use the actual ATS engine and detects model score drift.

| Function | Cases reviewed | Model evidence | Observed time |
|---|---:|---|---:|
| Cover letters | 5 | returned GPT 6 Luna | 3.932–7.331 s |
| LinkedIn analysis | 5 | returned GPT 6 Luna | 4.345–5.273 s |
| LinkedIn section regeneration | 5 | returned GPT 6 Luna | 1.340–1.866 s |
| Resume rewrite | 5 | returned GPT 6 Sol | 3.243–4.151 s |
| Interview questions | 5 sets of 10 | configured Luna; builder omits provider model telemetry | 4.859–7.506 s |
| Typed mock questions | 5 sets of 10 | configured Luna; builder omits provider model telemetry | 3.318–4.654 s |
| Typed mock scoring | 5 | configured Sol; builder omits provider model telemetry | 5.881–7.492 s |
| Grammar verification | 5 | configured Luna; boolean result only | 0.656–0.983 s |
| Role templates | 5 | configured Luna; builder omits provider model telemetry | 1.564–2.006 s |

Cover-letter word counts: **267, 278, 256, 283, 287**. All retained the supplied experience boundaries. Five rewrites retained names, dates, project/volunteer context, and the supplied five-customer metric without inventing revenue or management achievements. LinkedIn kept the original indirect endorsements, including “A volunteer said my instructions were clear and helped them know what to do.” Question sets matched role, level, and requested type. Typed scoring identified the missing learning/outcome portions of the intentionally brief answers; scores were 63, 55, 65, 65, 65. All five explicit grammar-error cases were detected. Role templates contained relevant skill/tool arrays.

## Validation and limits

The deployed development navigation/terms smoke passed: [run 38722613296](https://github.com/dlarosa92/jobhackai-site/actions/runs/38722613296), test step 10:48:28–10:48:44 UTC, after the candidate became live at 10:47:39 UTC. Candidate UI logic tests, model migration tests, evaluator access-control tests, application build, Functions build, grammar/ATS engine tests, and voice-coaching regression tests passed locally. PR #1016 and #1017 CI passed all executed gates.

Browser checks confirmed the word counter changes from 0 to 6 on editing and resets to 0 with Start Fresh. The candidate resume page displays the separate lifetime ATS and monthly feedback allowances while keeping saved results visible.

These are finite synthetic samples, not a guarantee for every resume or interview. Generation tests exercise the production model functions but do not each repeat upload, extraction, history persistence, payment, or microphone transport. Realtime audio code/model is unchanged. Some builders do not expose provider model/usage telemetry, so their configured model is distinguished from provider-confirmed model. Baseline OCR/encoding fixture failures are documented in the original migration audit; this follow-up does not change that engine.

## Corrected acceptance run and reliability observation

The corrected evaluator deployed to development at `ab4f89133c8fac24d6fe8af5f7322b15b4ee54b4` (10:57:38 UTC). It used the production deterministic ATS engine before model feedback.

- First corrected feedback run: four successful cases and one failed raw generation (career-change). The sanitized evaluator response did not identify the underlying cause, so it is not described as a proven provider outage or truncation.
- Independent full feedback rerun: **5/5 successful**, all five category scores and maxima exactly preserved. Overall deterministic scores: **50, 52, 50, 51, 58**. Returned model: Luna. Times: **6.102–7.292 s**. The customer endpoint's existing bounded short-mode retry and rule-based fallback remain unchanged; the raw evaluator does not exercise that full recovery wrapper.
- Corrected role tips: **5/5 successful**, role-specific sections and grounded previews, returned Luna; **6.046–11.397 s**.
- Voice scorecards: **8/8 successful**, returned Sol, **9.085–10.498 s**, no grounding/structure flags. Reviewed unsupported security claims, role-posting fit, junior transferable experience, retail leadership, engineering reasoning, injected posting instructions, missing requested metrics, and possible transcription error. Scores: **55, 86, 85, 85, 84, 60, 70, 81**. The model did not invent conversion figures, treat a student project as production proof, or follow injected instructions.

Across the session: **78 live evaluations attempted**, including the initial 10 feedback/tip cases superseded by the corrected runner, the four successful extra feedback cases and one failed raw generation, and **63 accepted cases** (five per 11 text functions plus eight voice scorecards). All outputs were manually reviewed for the relevant factual and role-fit criteria. This is a finite quality sample, not an error-free reliability claim.

The final candidate has **44 passing model/evaluator regression tests**. The 28 candidate UI logic checks and local grammar, ATS engine, voice-coaching, application-build and Functions-build checks also passed. Temporary development evaluator settings were removed after testing; final deployed closure is verified separately in the release record.
