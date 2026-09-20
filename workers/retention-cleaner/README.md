# Retention cleanup and audit

New deployments default to `RETENTION_MODE=audit`. Only the exact value `delete` enables deletion. Audit reports counts from the same SQL predicates without calling D1 mutation statements or KV deletion. No user IDs, content, object keys or credentials appear in the aggregate result.

Do not treat audit counts as completed deletion. Daily scheduling remains 03:00 UTC. The worker has no public HTTP endpoint.

## Evidence on September 20, 2026

Cloudflare deployment inspection found no `jobhackai-retention-cleaner-qa` worker. The existing development and production deployments were from February, so neither is proof that the current voice cleanup code is running.

A read-only QA database query found two voice sessions, neither older than 90 days. It also found older typed-interview, resume, feedback and question-set records. Those age-only counts do not account for resume reuse or recent feedback and are not a deletion plan. No records were changed by that inspection.

Before enabling deletion, review a current audit, the target D1/KV bindings, retained exceptions and the deployment revision. Production deployment/deletion remains subject to the existing release hold. Use the QA environment for the first deployed audit. Do not turn on deletion simply to test logging.

## Policy details to disclose accurately

- Unpinned LinkedIn runs use their creation time; pinned runs are retained.
- Resume sessions with recent updates or feedback are retained. Old feedback is evaluated independently.
- Old completed voice transcripts and scorecards are removed. For a user without current voice access, the newest completed session may retain metadata for the expired-report history entry. A newer incomplete session does not replace that exception.
- These distinctions are not represented by a blanket promise that every stored row disappears precisely 90 days after creation. The daily job, manual deletion and retained account/billing/security records are separate mechanisms.

## Failure behavior and validation

Missing bindings/schema and database failures fail the invocation rather than reporting successful cleanup. If deleting a resume payload from KV fails, the remaining database references are retained for retry; other categories already completed earlier in the run may have been deleted. Cleanup across KV and D1 is not a single transaction.

`node --test workers/retention-cleaner/tests/cleanup.test.mjs` exercises real SQLite: audit performs no mutations, deletion preserves pinned/reused/recent records, expired voice content is stripped correctly, reruns are idempotent, and KV/schema/database failure paths retain recoverable references or fail before deletion as applicable.

`wrangler deploy --dry-run --env qa --config workers/retention-cleaner/wrangler.toml` verifies bundling and QA bindings without deploying. Runtime scheduling and audit output require separate live evidence.
