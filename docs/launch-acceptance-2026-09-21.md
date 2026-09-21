# Launch acceptance continuation — September 21 UTC

This record supersedes older statements that PR913 is unmerged or its Pages
bindings are waiting for deployment. It is a verification record, not production
release approval. Owner requested completion of QA and the bounded directory
experiment on September 20 Eastern; routine staging work continues.

## Deployed application

PR913 and the no-code ancestry repair PR929 merged to development; PR928 merged
to QA. The repair retained the exact application tree already tested on dev.

| Target | Revision | Successful canonical deployment |
| --- | --- | --- |
| Development | ee9707d753ee01f43f8ad879cd3357628ffc912f | 848907d1-3c92-4ed0-9167-2619b42d92b0 |
| QA | e704c8c857c699beff73073211a9d26dd491fa70 | 3001659a-feb4-41ce-b63b-181e46fddaad |

Both have the matching isolated D1 and Durable Object bindings, RPC enabled and
managed transport true. Anonymous POST to the old `/api/voice/session` returns
409 `voice_transport_updated` on both custom domains and both root Pages hosts.
The replacement `/api/voice/connection` returns401 without authentication.
These checks invoke no provider and prove neither authenticated success nor
closure of a previously issued legacy call.

## Voice runtime

Development deadline worker was enabled for controlled new-session testing at
02:52UTC, version `19da24ea-c16d-4f0b-8060-e161881bd93f`. The deploy used the same
reviewed source as origin/dev0 with only `VOICE_DEADLINES_ENABLED:true` overridden.
Dry run passed; independent deployed settings confirm true, encrypted key name
and correct development D1. QA deadline worker remains disabled pending the
development runtime test. Source defaults remain false for safe future deploys.

This staging enablement does not clear any legacy hold or claim a completed
credential drain. Old immutable issuers have the recorded Access restriction;
authenticated denial, prior credential/provider closure evidence and any
reconciliation remain open. Do not erase, relabel or release those holds based
on time elapsed or empty managed ledgers. Production acceptance still needs the
complete cutover evidence. No microphone or provider call was started here.

## Analytics repair

At the correct test property502443078, stream12184859894, measurementG-VH888WWY3M,
the Measurement Protocol panel explicitly showed no API secrets, despite an
encrypted secret existing in Cloudflare. The Google Create control was available
without an acknowledgment prompt. A new QA-only entry named
`JobHackAI QA revenue delivery 2026-09-20` was created. On the owner's explicit
request, its value was transferred directly from the named settings row into
Cloudflare's encrypted `GA4_API_SECRET` field without printing, photographing,
saving to disk or putting it in chat. The temporary browser-runtime variable was
cleared. Cloudflare confirmed encrypted storage; secret-update worker version
`4b327db8-e3ff-40e7-9c7f-7af4f6b462eb` kept delivery false.

QA Sandbox delivery was then enabled from the reviewed worker source, version
`c4cfacab-0966-4505-b9ef-7109732fe244`, five-minute cron. No production destination
or development delivery was enabled. Initial read-only QA queries show zero
checkout attribution contexts and zero linked payments; therefore existing
Sandbox payments cannot prove campaign revenue receipt. A fresh tagged checkout
with consent, then actual Google purchase/refund receipt, remains required.
No synthetic client IDs, fabricated purchases or timestamp changes were used.

## Directory and owner steps

The [bounded experiment](directory-experiment-scorecard.md) fixes category,
market, four-week window, spending/effort limits and decision rules. Its review
clock starts only at verified public launch. Public release, indexing and final
campaign publication remain held until the tested release package is reviewed.

Live QA filtering and reset passed. Keyboard activation of Skip to content
scrolled but left focus on BODY. The candidate adds `tabindex=-1` to the shared
main target on all eight generated pages. Local candidate browser verification
now reports activeElement MAIN#main after Enter; three existing consent tests
pass. No new tracking or publication behavior was added.

The QA login tab was observed on the production login URL during this run and
returned to QA. Both development and QA currently require the owner's login;
one combined sign-in request is pending. No login credentials were read. The
private Analytics secret request is CLOSED; do not repeat it. Human voice ending
acceptance will be requested only when the authenticated setup is ready.

Remaining release evidence includes actual managed call creation/end/reconnect/
deadline behavior, saved report and entitlements, complete usage reconciliation,
fresh checkout and Google receipt, disposable-account privacy/lifecycle checks,
directory inbox receipt and production-specific rollout verification. Do not
call these completed because local tests or configuration checks passed.
