# Voice QA infrastructure prerequisite

This candidate promotes the development voice deadline worker and its CI
release procedure to QA before the separate voice application candidate.
It is based on develop 4c7fec4974c0285688ebed02f19a6bc17947b761.

The November 8 refresh includes development PR #1182, which preserves only
allowlisted response categories for future ambiguous hangup 404s. It uses the
existing error field and adds no schema or raw-content retention. The existing
QA provider-call creation behavior remains intact. The deadline alarm retains
the same hold and does not retry the uncertain call. This is diagnostic evidence,
not acceptance of network recovery. Two unconfirmed closures and one historical
unconfirmed creation attempt remain in development; none were rewritten.

## Scope and ordering

- Promote the deadline implementation already exercised in development,
  including the one-time transition from audio setup to the interview timer.
- Add only migrations 033 and 035 after recording a D1 recovery bookmark.
- Keep the current QA application and its provider-call creation behavior.
  Existing QA interview deadlines continue to work with null setup fields.
- Preserve the existing Worker, D1 database, Durable Object namespace,
  secrets, scheduler enablement, call records and unresolved operation holds.
- Do not apply migration 034 or enable question retry.

The Worker Release workflow verifies the current branch, exact target,
schema, bindings and deployment identity. It must complete successfully on
development before this candidate can merge to develop. The separate voice
app PR must wait for this QA infrastructure release to finish, then rebase
onto it. Pages and Worker deployments are independent.

## Validation

The existing QA app with the promoted deadline worker passes 30 actual
Workers runtime tests with intercepted provider requests, plus type checking.
Five release-guard tests cover eight CLI scenarios and apply the two exact
migrations to SQLite while preserving existing records and uncertain calls.
The updated app's activation tests are part of its separate candidate.

These results do not replace the remaining live-device acceptance or provider
closure evidence. No production release is included. The workflow uses the
reviewed public account ID; the API credential remains in GitHub secrets.
