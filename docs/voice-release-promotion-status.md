# Voice release promotion status

Verified October 31, 2026 through GitHub, fetched branch refs and Cloudflare
Pages project configuration. No merge, deployment or migration was performed.

## Required route

`feature -> dev0 / development -> develop / QA -> main / production`

Cloudflare deploys each project's configured branch independently. A PR to
`main` does not automatically pass through development or QA first.

| Environment | Branch | Verified canonical deployment revision | Host |
| --- | --- | --- | --- |
| Development | `dev0` | `d5e864cd63777b09deab07bd7de7e46a6910c520` | `dev.jobhackai.io` |
| QA | `develop` | `52466965a486d7d1a8facd2d2e6a616db29ebe19` | `qa.jobhackai.io` |
| Production | `main` | `e3b98eb320253ecb4467205d74ce5d480c907658` | `app.jobhackai.io` |

All three canonical deployments report success and automatic branch deployment
is enabled. This verifies routing, not voice acceptance.

## Why PR 1032 is not the release candidate

[PR 1032](https://github.com/dlarosa92/jobhackai-site/pull/1032) is still an open
draft, unmerged, targeting `main` from `claude/recursing-dewdney-8a8824` at
`5f3152aa46afbda38ce36791ee23f2018b95a519`. GitHub reports it not mergeable.
It is an older production draft, not a completed QA promotion.

Development contains the original voice work (#1033), subsequent timing,
startup/caption/UI/report fixes (#1064-1067), topic/score-evidence controls
(#1080) and spoken-goodbye handling (#1082). Comparison with current `develop`
shows the voice promotion is missing, including migrations 033/034 in source.
The older production PR also lacks the latest topic/score-evidence/goodbye work.
The respectful-disclosure and report-grounding corrections are in
[development PR 1089](https://github.com/dlarosa92/jobhackai-site/pull/1089),
targeting `dev0`. They have not been deployed to development, QA or production.
The review correction also distinguishes unverifiable report evidence from an
insufficient answer sample in both free and full reports. Free reports retain
that reason without promising excerpts they cannot display. The 54 targeted
report, evidence, coaching and model regression checks passed locally.

The failed `candidate-ui` run stopped installing Playwright 1.56.1 on Ubuntu
26.04 before browser assertions ran. Current `main` already pins Ubuntu 24.04
through #1081. Reconcile with that fix and rerun the final candidate; do not
count the old failure as a fresh UI regression or claim a passing rerun.
`e2e-tests` was skipped. Bugbot was neutral because its usage limit prevented
review, not because it found no issues.

## Remaining work, in order

1. Finish the scoped voice candidate from development: include the local
   disclosure fix and resolve or explicitly disposition the clarification,
   feedback-grounding, language-scope and accessibility findings in
   [the release quality plan](voice-partner-release-quality.md).
2. Validate that candidate in development, including a visibly confirmed
   recording of natural completion and interruption recovery. Preserve the
   existing owner-observed goodbye pass; missing recording alone is not a
   reason to repeat it.
3. Prepare a scoped QA promotion from the accepted development changes to
   `develop`. Review shared-file conflicts and unrelated branch changes;
   do not blindly merge all development work or merely retarget the stale PR.
4. Recheck the actual QA database schema, apply required migration 033 through
   the release procedure, keep `VOICE_RETRY_ENABLED` off, and verify the app,
   worker and configuration versions agree. Historical evidence found 033
   missing in QA; the database was not rechecked in this audit.
5. Validate the deployed QA candidate: captions, full natural close,
   clarification/interruption, reconnect, near-deadline close, feedback-only
   and eligible reports, access/credits, one history record, mic/provider
   closure, desktop/mobile and keyboard/screen-reader behavior. Run suitable
   post-deployment checks; a test against an older deployment is not candidate
   evidence. Avoid repeating real billing/email actions merely to turn CI green.
6. Prepare a production promotion from the QA-accepted candidate, reconcile
   current main and rerun candidate checks. Supersede the old production draft
   once its replacement is concrete and traceable. Production merge remains
   separately authorized. Brighton staff/IT/training readiness and pilot
   criteria remain in the release quality plan.
