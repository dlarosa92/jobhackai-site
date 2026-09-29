# Managed voice staging record, September 20

Implementation reviewed for this database preparation: `f40b2914f1897d5d60e6c0b5cdf57ee20ee4958e`
in draft PR913. The app still uses the earlier deployed voice implementation.
This record is not acceptance of the new provider lifecycle or a production release.

## Database preparation completed

Only `028_account_deletion_recovery.sql` was applied, with SHA256
`e2c92fed0f7201381c5428217495c371d6aa17090b18ad9f9a2fd7ae604b39f6`.
Do not edit or replay earlier billing migrations to reproduce this step.

| Environment | Database | Result |
| --- | --- | --- |
| Development | `c5c0eee5-a223-4ea2-974e-f4aee5a28bab` | Applied; all 27 schema objects verified |
| QA | `80d87a73-6615-4823-b7a4-19a8821b4f87` | Applied; all 27 schema objects verified |
| Production | `f9b709fd-56c3-4a0b-8141-4542327c9d4d` | Read-only check: recovery tables remain absent |

Each staging database was exported privately before migration. Applying the
migration to each local database copy preserved all existing row content and
schema in its 27 pre-existing application tables. Integrity checks passed,
with no new foreign-key violations. Cloudflare returned successful application
receipts. Independently exported post-migration schemas exactly matched the
reviewed expected schemas: 12 new tables, 10 indexes and five triggers.

The initial dev Time Travel bookmark request failed with Cloudflare error7500.
A successful full private backup was used instead. Both application receipts
include final bookmarks. Backups, schema exports, checks and receipts are in
`/tmp/jobhackai-managed-cutover-20260920`, with directory mode0700 and private
backups mode0600. Do not attach database contents to issues, chat or this repo.
No restore was performed. Future changes to this applied schema need a new
additive migration.

## Deployment and key prerequisites

Fresh Cloudflare project reads confirmed:

| App | Canonical revision | Deployment |
| --- | --- | --- |
| Dev | `8d2ae9fb4d0f478744b42edcdbaf174abae26dcd` | `b4b03f09-3c5d-444f-82a5-721b18e5ba2f` |
| QA | `c672536477446e732158a8a1b84ddd25a4de7679` | `360dafed-7d6a-4257-a875-0cab805f1432` |
| Production | `ed00ca62d1bed102747085d736dad931e0a651c3` | `f40d2415-4946-414f-8e00-099e67b80a85` |

At22:12-22:17UTC, both deadline workers were installed from reviewed source
`70e51b3f42b1aecc75d887e92bad88206b5e5140`. The owner supplied the existing
DEVELOPMENT OpenAI key through hidden local input and explicitly confirmed
that dev and QA use this same key. It was uploaded as an encrypted secret to
both workers. No production key was requested, displayed, copied or changed.

| Worker | Version | Durable Object namespace |
| --- | --- | --- |
| `jobhackai-voice-deadlines-dev` | `d3e5bec1-5bb8-47b5-9036-1b45b4e2bf09` | `d53b296ce05a49c3a8cabf705ebae94d` |
| `jobhackai-voice-deadlines-qa` | `55ec3c31-5cfc-4817-a4ec-93b7e58f4251` | `0af6247a41cb45deaab5337d813d93e7` |

Both keyed dry runs and deployments succeeded. Independent Workers settings
and deployment reads confirmed the encrypted secret name, each environment's
D1 UUID, class `VoiceDeadline`, separate namespaces, and
`VOICE_DEADLINES_ENABLED=false`. There are no public worker targets. Secret
presence and an owner-confirmed key mapping do not prove provider permissions
or the app/worker runtime key-identity check.

Both Pages projects now have the matching `VOICE_DEADLINES` namespace saved
in their canonical deployment configuration. A configuration review found
that both use compatibility date2024-01-01, which predates RPC support by
default. A local test with the actual compiled deadline worker reproduced
`arm is not a function` without a flag and reached the worker's expected
`voice_deadline_disabled` response with `rpc`. Only the `rpc` compatibility
flag was added; the existing date was preserved. Before/after comparisons
verified every other deployment setting and both canonical deployments
unchanged. The app build/postbuild also passed. This fixture used no real
key, database or provider request.

**Pages has not yet been redeployed.** The saved namespace and compatibility
flag therefore are not proof of a working live app binding. Managed transport
is not enabled and scheduler flags remain false. Controlled dev, then QA,
application deployment and actual RPC/provider verification remain required.
The private evidence directory contains `worker-*-installed-verified.json`,
`pages-*-binding-verified.json`, `pages-*-rpc-verified.json`, keyed deployment
receipts and `check-pages-rpc.mjs`. Never attach the private key file.

A separate fresh settings read also confirmed `GA4_API_SECRET` is present as
`secret_text` on `jobhackai-analytics-delivery-qa`; `DELIVERY_ENABLED=false`.
The prior missing-key/secret asks are resolved. Google setup acknowledgment,
secret validity and actual server purchase/refund/renewal receipt remain
unverified; secret presence does not establish Analytics delivery.

## Old issuer inventory and remaining cutover

The complete production-environment deployment listings for the dev and QA
Pages projects returned 1,631 and306 deployments respectively, without page
errors. Of these, 69dev and28QA successful deployments retain both an enabled
voice setting and an OpenAI secret binding. These counts include each current
canonical deployment. They are possible old issuers based on configuration,
not proof of current reachability or active provider calls. The complete preview
histories subsequently returned 2,092 dev and 3,143 QA deployments with no page
errors and no OpenAI secret bindings. No deployment was deleted and no key,
app flag or binding was changed.

### Legacy deployment endpoint restriction applied

The signed-in Cloudflare dashboard showed one existing Access application:
`b0203e46-2049-4269-805f-f88670289553`, covering
`*.jobhackai-app-dev.pages.dev`, with its owner-only Allow policy. There was no
QA application. The OAuth account application-list endpoint incorrectly gave
an empty inventory relative to the dashboard; organization and zone Access
reads returned authorization errors. Do not use that empty list as absence
proof or overwrite the existing application.

A separate, reversible self-hosted application was created through the
dashboard: **JobHackAI legacy voice issuer block - dev and QA**, ID
`a3d6ae55-fb0d-4f83-81d3-f335b0567c42`. Its only policy is **Block legacy voice
token issuance**, ID `ceb7e94d-e7b2-487d-8de5-1a50892d8d77`, action Block,
Include Everyone, with no Allow, Bypass or Service Auth exception. The saved
destinations are exactly:

- `*.jobhackai-app-qa.pages.dev/api/voice/session`
- `*.jobhackai-app-dev.pages.dev/api/voice/session`

First, the policy was piloted on the obsolete QA deployment `6e547e4f`.
Its endpoint changed from application JSON405 to a302 redirect to
`jobhack.cloudflareaccess.com`; its login page stayed200. After expanding
to the two wildcard paths, independent anonymous GET checks of all97
identified candidate deployment URLs returned the same Access redirect,
with zero exceptions. Requests used the consistent User-Agent
`JobHackAI release verification` and did not follow redirects or invoke a
provider. Evidence: `legacy-issuer-access-verification.json` in the private
staging evidence directory. The dashboard was reopened and both destinations
and the policy were re-read after saving.

This is saved-policy and anonymous edge-routing evidence, not authenticated
denial or proof of credential drain. The owner policy tester returned
`access.api.error.invalid_user_id` and evaluated zero policies; its accompanying
"Access denied" heading is not a valid acceptance result. An authenticated
denial check remains outstanding. The more specific path application is
intended to override the existing broad development Allow application.

The custom domains `dev.jobhackai.io` and `qa.jobhackai.io`, and the root
`jobhackai-app-{dev,qa}.pages.dev` hosts, still return application JSON405 for
GET on the old endpoint. Their current voice flow remains available pending
the managed deployment. They must be disabled/switched as part of the actual
cutover, and previously issued credentials/in-flight calls still need drain
evidence. The restriction does not target `/api/voice/connection`, other site
paths, or any production hostname. Rollback is removal of only the new
application after checking the need to restore these old endpoints; preserve
the pre-existing development Access application. Do not remove the shared
policy if it has acquired another application attachment.

Switching only the custom-domain deployment does not establish that earlier
immutable URLs or already-issued credentials are drained. Finish the old-issuer
authenticated restriction check and canonical-host disable/drain procedure,
then deploy the app in development before QA using the installed disabled workers. Do not revoke an old
key without establishing its environment/production dependencies. Actual invocation/provider
evidence, abandoned-browser expiry, recovery, one-time entitlement use, report
quality, human ending acceptance and measured cost remain required.

The earlier human voice/Google acceptance requirements remain open. The owner
provided the private worker key and QA Analytics secret; do not repeat those asks.
Server Analytics delivery remains disabled. Accepted pricing and
`gpt-realtime-mini`/`marin` remain unchanged. Production and public marketing
release still require the final concrete approval.

References checked September20:
[RPC compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#durable-object-stubs-and-service-bindings-support-rpc),
[Pages project update API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/),
[Cloudflare deployed secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Pages deployment inventory](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/),
[immutable preview URLs and access controls](https://developers.cloudflare.com/pages/configuration/preview-deployments/),
[Access policy actions](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/),
[specific path precedence](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).
