# Scoped voice production preparation

This local candidate carries voice code deployed to QA at
`82d60170e74de6aeb676d1c5b2958eb92dd1125b`. It is based on production
`823ee4dc0f3f66e7b28920fbdbcd7be9e181b80c`. Recorded QA acceptance is complete. The session recovered after a physical
network outage, preserved the question, mute state and original deadline, used
one free session, generated a graded report and reopened it after reload. Both
provider attempts are confirmed closed; no new uncertain record was added.

All changed voice modules, routes, diagnostics and worker code come from that
QA revision. Production's unrelated files remain unchanged. The voice page
keeps production's existing header, cookie and role-selector references. The
account-menu accessibility patch is applied independently of older QA
navigation behavior. Existing package scripts remain, with the QA voice
scripts added. Production role-selection analytics and navigation discovery
are preserved.

Local validation: full voice suite, 232 focused managed-call and privacy
checks, application build, native worker tests, worker type checking and five
release-preflight checks pass. Hosted candidate checks have not run.

Release sequence:

1. Accept the recorded QA interview, including sound, responses, recovery,
   one free use, report persistence and confirmed provider closure.
2. Promote the QA-verified infrastructure prerequisite first. Retain the
   existing production namespace and database, record the recovery bookmark,
   and apply only missing migrations 033/035. Verify the worker release before
   the new app. Do not apply 034 or enable question retry.
3. Promote only the QA-accepted voice application changes through a scoped
   production promotion, with exact-source evidence and current checks.
4. Verify production assets, worker, schema, authenticated UI and the bounded
   real-audio smoke. Record any unverified behavior explicitly.

The physical delayed-reconnect development gate passed. Historical uncertain
provider records remain held; none is declared closed by elapsed time or a
generic 404. Broader historical test notes are not a reason to restart accepted
tests, nor evidence that unperformed cases passed. The separate conduct-warning
observation is not fixed by the network change.
