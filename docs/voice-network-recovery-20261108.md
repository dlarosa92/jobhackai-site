# Network recovery follow-up, November 8

## Current deployment and live retest

PR #1183 merged through dev0 as 69a508227f109aeb1ca8bb82cbcc1c3a8c50c04a.
Canonical development deployment and exact served assets were verified. All
ten executed PR checks, five development branch checks and three authenticated
post-deployment UI tests passed. The unchanged Worker required no release or
migration. The scoped change is included in draft QA candidate #1168, whose
101 focused tests, full voice suite and app build pass locally.

The third recorded Safari run still FAILED network recovery. After a
31.521-second outage, the owner requested Reconnect 147.432 seconds after
the browser came online. This was not the planned immediate reconnect.
The original deadline had more than 14 minutes left. Diagnostics now establish
an application 409, voice_call_close_unconfirmed, and the durable provider
category close_http_404:empty:none:none:unclassified. The delay is not proven
to explain the provider response. No replacement was created, and the terminal
review safeguard saved and ended the application interview. This did not
exercise the new temporary-error retry branch.

Both captured answers (71 words) and one feedback-only report saved and
reopened; one credit was used. No unended application interview remains.
The provider call is still uncertain, alongside three older uncertain
attempts. Application completion is not proof of provider closure. The approved
addendum was sent in OpenAI case 19425445. Immediate and mid-answer recovery
remain unaccepted; QA and production are unpromoted. See the local evidence
folder's safari-network-recovery-03-review.md and run manifest.

## Original reproduction and correction

The second controlled Safari network interruption did not resume. The captured
conversation saved and reopened, one development credit was used, the original
deadline was unchanged, and the provider call was confirmed closed. No
replacement provider attempt was created. The mid-answer case was not run.

The initial failed request's status and reason were not captured. The temporary
Pages tail and targeted observability queries provided no usable request log.
Do not attribute this failure to a generic 404, the earlier unresolved calls,
or a specific provider incident. Only nine candidate words were captured, so
this run also does not prove preservation of two substantive answers.

Two independent client problems were reproduced with failing regressions:

- Every reconnect error finalized the interview, including temporary network,
  authentication-network, scheduling and service failures.
- A successful network replacement did not request the current question again,
  unlike microphone and Audio help recovery.

The correction retains the same interview, transcript, attempt identity, credit,
mute choice and original deadline on recognized recoverable failures. It offers
an explicit retry or Finish. It makes no automatic replacement request. The
server still refuses unresolved provider mutations, expired/deleted sessions
and invalid ownership; known terminal or review errors still save and close.
A recovered channel requests the displayed question once without advancing the
question budget. Late failure responses cannot reopen a finished interview.
Retiring a connection also invalidates its configuration and greeting timers
before microphone acquisition or network I/O, so they cannot close a retrying
audio check.

Development diagnostics now retain only allowlisted request stage, status,
failure category and network-state events. Raw error messages, credentials,
provider identifiers, speech and SDP are excluded. The feature still requires
the development host and explicit local diagnostic flag. These diagnostics
will distinguish the initiating request failure on a future run, rather than
assuming a successful close identifies that earlier failure.

Validation: seven regressions failed before the correction. Review found two
additional stale-timer cases, both reproduced before fixing retirement. The
final browser/diagnostic suites pass 101 tests; the unchanged managed-interview
and provider suites passed 116 tests. The full voice suite and application build
pass. The built JavaScript matches the source.
These automated checks do not override the failed live result above.
Promotion remains dev0, then develop/QA, then main.
