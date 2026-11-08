# Voice QA infrastructure prerequisite

Promote the development voice deadline worker and guarded release procedure to QA before app PR #1168. The baseline is develop 4c7fec4974c0285688ebed02f19a6bc17947b761. The worker implementation exactly matches the development-accepted candidate 5172327ce27513a8a412156ddf07026e0c082f74 (PR #1186).

Healthy opted-in clients renew a short private connection lease. When renewal stops, the worker attempts exclusive provider closure before a delayed reconnect. Only confirmed closure admits replacement. The original interview deadline, credit and transcript remain unchanged. Cached clients without the watch retain their existing deadline behavior. There is no new public endpoint, namespace or automatic clearing of uncertain calls.

The recorded November 8 Safari physical network retest passed on development: two answers before outage, delayed reconnect after network restoration, same question replay with mute preserved, clear replay and a subsequent response confirmed by the owner, one saved and reopened report, one credit and both provider calls confirmed closed. This is a scoped recovery pass, not a complete browser or coaching matrix. Five historical development holds remain untouched.

## Deployment order

1. The guarded CI release records a D1 recovery bookmark, applies only missing migrations 033 and 035, then verifies exact bindings and deploys the worker with existing variables and secrets preserved.
2. Keep the deployed QA application and provider call-creation behavior during this prerequisite. Migration 034 remains unapplied and question retry remains off.
3. Verify the exact worker release, schema and canonical QA deployment. Rebase #1168 on this verified revision, then run its candidate checks and deploy the scoped app through develop.
4. Complete QA acceptance before preparing the production candidate. No direct feature-to-main promotion is authorized by this prerequisite.

The current QA read found both migrations missing, the correct existing database/namespace/secret binding and enabled scheduling. Four existing uncertain QA records remain unchanged.

## Validation

All 37 native Workers runtime compatibility and connection-watch tests pass with the existing QA application. The seven new private-RPC cases cover healthy renewal, closure/replacement ordering, foreign/stale requests, duplicate arming, persistent closing claims and ambiguous-result holds. New application readiness/admission tests belong to #1168; the prerequisite does not introduce that application behavior early. Type checking and all five release-guard tests pass. The exact development implementation separately passed 42 runtime tests and the recorded live recovery.

Hosted candidate checks and post-deployment verification must pass on the refreshed head. Local evidence and private recording remain in the Brighton preparation evidence folder; no account identifiers, transcript or recording are committed.
