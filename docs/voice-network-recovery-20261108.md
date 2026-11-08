# Network recovery follow-up, November 8

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

Development diagnostics now retain only allowlisted request stage, status,
failure category and network-state events. Raw error messages, credentials,
provider identifiers, speech and SDP are excluded. The feature still requires
the development host and explicit local diagnostic flag. These diagnostics
will distinguish the initiating request failure on a future run, rather than
assuming a successful close identifies that earlier failure.

Validation: seven regressions failed before the correction. The focused client,
diagnostic, managed-interview and provider suites pass 215 tests. The full voice
suite and application build pass. The built JavaScript matches the source.
This is local evidence only until CI, exact development deployment checks and
the live retest succeed. Promotion remains dev0, then develop/QA, then main.
