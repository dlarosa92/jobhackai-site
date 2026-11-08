# Clarification requests and report evidence

## Reproduced issue

The November 8 development Safari control test kept all nine repeat/rephrase requests on the original question. It also remained open after a bare example preface and a historical quotation about ending an interview. Manual Finish saved one feedback-only report, one credit was consumed, the report reopened after reload and the provider call closed without error.

The report counted 55 candidate words because clarification requests and the example preface still entered assessment evidence. The actual answer contained 30 words. No numerical score was issued in this run, but control speech could influence the model input, eligibility threshold and quote validation.

## Change

Assessment now uses the same standalone-control classifier as live turn planning. Repeat, rephrase, hearing checks, skip requests and requests to begin/continue an answer are excluded from assessment input, eligibility counts and supporting quotations. Substantive answers that contain those phrases remain evidence, including the historical ending quotation and a clarification request followed by an answer.

The separate hearing-check expression in the scorer is removed. Its greeting, okay/ok, now and clearly variants are covered by the shared classifier. The frontend classifier asset version is advanced for that small vocabulary alignment.

## Validation and limits

- Four new report regressions failed before the fix.
- All 95 focused report/turn-plan checks pass after the fix.
- The full voice suite and application build pass.
- Offline replay of the actual stored transcript retains the one 30-word answer, removes the ten standalone controls/preface turns and makes no provider request.
- Existing saved reports are not silently regraded or changed.
- The recorded live run verifies conversation controls on the preceding development revision. It does not establish an audible test of a later deployment.
- Original network, provider-closure, browser/device and remaining live acceptance gates are preserved. This correction does not authorize or prove QA or production promotion.

Private recordings, the exact development session and detailed receipts are retained outside the repository in the owner's Brighton preparation evidence folder.
