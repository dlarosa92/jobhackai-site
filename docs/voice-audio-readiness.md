# Voice audio readiness

Implementation candidate prepared November 1, 2026 against dev0 `a13ebd30ba34d2651596a6e699c744506ff5bce3`. Local validation is separate from deployment and recorded owner acceptance. This increment has not been deployed.

## Customer behavior

1. Choose **Check audio** and allow normal microphone access. The page checks actual transcribed speech, displays a microphone meter where supported, and plays the voice through the interview's audio element.
2. If playback is blocked, choose **Enable audio**. **Play again** repeats only the check. Help covers site sound, OS/browser microphone permission, volume and output selection.
3. **I can hear you. Start interview** stays disabled until input and playback checks pass. The customer confirms physical audibility. The app waits for the provider's interview configuration acknowledgement, then requests activation.
4. The server reserves the free interview, pack credit or subscription session only at activation. Failed, cancelled or abandoned setup creates no interview or scored result and uses no early-end grace. Setup speech and replay use no interview question opportunities.
5. During an active interview, Audio help pauses new questions and repeats the current question after playback recovers. A disconnected microphone offers Reconnect. These recoveries retain the current interview ID and do not request another credit.

The browser cannot detect whether a physical speaker is muted or override denied browser/OS permissions. Explicit hearing confirmation is necessary. This change protects setup failures; it does not introduce a blanket automatic refund for every technical failure after a confirmed start. Existing completion and early-end rules still apply after activation.

## Server and recovery contract

- Managed transport is required. Keep `VOICE_MANAGED_CALLS_ENABLED=true` and the existing legacy-issuer cutover protections. The legacy direct-credential path does not acquire this new server gate. Unreserved managed starts from older clients are rejected with a refresh/retry response.
- A provisional check has a server deadline of 120 seconds. Admission is atomic, with at most three new checks per account in 15 minutes across tabs/browsers. A retry of the same ID cannot extend its original check. The cooldown bounds abandoned provider cost without spending an interview.
- Migration 035 records original setup deadline, first readiness intent and initial entitlement mode. It adds no transcript, raw audio, credentials, device name or job context to the control ledger.
- Activation checks authenticated ownership, current provider attempt, account admission, entitlement mode, open status and deadline. D1 reservation remains the atomic entitlement authority. Concurrent activations and lost receipts resolve against the same owned session record.
- The deadline worker acknowledges the one allowed transition to 20 minutes from first readiness intent before reservation. A delayed setup alarm cannot terminate a valid activated interview. Alarms persist retry/review behavior for uncertain provider closure.
- Old peer connections, stale playback promises, late setup transcripts and cancelled activation responses cannot start questions on a replacement or ended connection. A microphone disconnect while configuration is pending blocks activation.
- Provider configuration is acknowledged before credit activation. Each setup replay has response-specific audio-check instructions so a lost acknowledgement cannot turn Play again into an interview question. This uses the documented [Realtime response override](https://developers.openai.com/api/reference/resources/realtime/client-events).

## Local verification

From the repository root:

```sh
node --test app/functions/_lib/__tests__/voice-managed-client.test.mjs
node --test app/functions/_lib/__tests__/voice-managed-interview.test.mjs
npm --prefix app run test:voice
npm --prefix app run build
npm --prefix workers/voice-deadlines run typecheck
npm --prefix workers/voice-deadlines test
git diff --check
```

The managed suites exercise actual SQLite reservation/activation behavior and the real client event handlers. Worker tests use local D1 and actual Workers/DO alarms with intercepted provider calls. They cover untouched free/pack/subscription balances and grace on abandoned setup, duplicate activation, owner/stale-attempt rejection, close/activation races, bounded admission, provider configuration failure, silent/muted/disconnected input, playback recovery, question preservation and stale alarms. They do not prove real speaker audibility or deployed provider closure.

For a visual-only preview:

```sh
node app/tests/ui/voice-audio-fixture.cjs
```

Open `http://127.0.0.1:8770/voice-interview.html?audio=blocked` for click recovery, or `http://127.0.0.1:8770/voice-interview.html?mic=silent` for the disabled Start state. The fixture uses the actual page/client with simulated auth, microphone, playback and API responses. It consumes no real credit and requests no microphone permission. Close it after review. It is not a live interview or audible acceptance result.

## Development rollout order

Obtain the applicable development rollout approval. Recheck the exact dev0 head and current remote bindings/configuration before applying anything. Use the normal reviewed feature-to-dev0 PR path; preserve candidate hashes and deployment receipts. Do not promote directly to main.

1. Back up the development database and verify the existing managed-call, closure-receipt and early-end-grace schema (including 033). Migration 034 is the separate question-retry feature, is not a dependency, and remains held with `VOICE_RETRY_ENABLED` off. Apply only `app/db/migrations/035_voice_audio_readiness.sql` to `jobhackai-dev-db`, then verify all three columns and the rate index. This additive migration must precede both runtime deployments.
2. Deploy the reviewed deadline worker to the existing `jobhackai-voice-deadlines-dev` target (`workers/voice-deadlines`, Wrangler environment `dev`). Preserve the existing D1/DO bindings, scheduling flag and issuing key. Do not roll this worker back to code that cannot recognize readiness extensions while activated calls remain.
3. Deploy the exact reviewed app candidate through dev0 to `jobhackai-app-dev`. Verify the canonical deployment, served HTML and both versioned scripts (`20261101-audio-readiness-1`) against the candidate. Confirm managed transport and the correct deadline binding through authenticated development checks.
4. Run the fresh-account acceptance below on `https://dev.jobhackai.io/voice-interview`. Verify credit/grace state and actual provider closure from server evidence as well as the screen. Preserve the prior spoken-finish retest and full natural-interview cases.
5. Only after development acceptance, prepare the same accepted candidate for develop/QA with its own database migration and worker/app alignment. QA acceptance precedes a separately authorized main/production candidate and production checks.

If rollout needs to pause, keep the additive columns and the compatible deadline worker available for existing calls. Do not disable managed transport to fall back to the unprotected legacy issuer. Follow the existing admission-stop and closure/reconciliation procedure; never delete a namespace or rotate its issuing key with unresolved calls.

## Recorded acceptance addition

Use an existing designated fresh free test account with unused free entitlement and grace, plus existing pack/subscription accounts for the applicable accounting cases. Do not use a real purchase or reset a customer's entitlement for this test. Record exact browser/OS versions and starting server balances. The QA recorder's Share tab audio option is for recording evidence, not a customer requirement.

| Case | Action | Required evidence |
| --- | --- | --- |
| First use | Check audio, speak briefly, hear the sample, then confirm | No interview row or debit before confirmation; exactly one afterward; full 20-minute interview allowance; question one starts once |
| Blocked or silent output | Block site playback or choose a silent/wrong output, then use Enable audio/Play again | Clear help; no start without explicit hearing confirmation; recovery within the page when browser policy allows |
| Missing input | Deny/ignore permission, silence/mute the mic, or disconnect it before confirming | Start disabled or actionable error; no credit/grace consumption; replacement mic is checked again |
| Cancel and timeout | Cancel a check, let one expire, and abandon a tab in a separate case | Free entitlement/grace unchanged after refresh and another-browser login; no scored report; actual provider cleanup verified |
| Interrupted start | Lose the network/configuration acknowledgement; retry with the same ID | No debit before activation; a lost activation receipt recovers once; no second reservation or premature question |
| In-interview recovery | Interrupt output or disconnect the mic after one answer; recover | Current question/answer retained; replay uses no question opportunity; reconnect uses no extra credit |
| Rapid retries | Open checks across tabs within the bounded attempt window | Cooldown is clear, server enforced and does not consume an interview |
| Regression | Retest polite spoken Finish and the planned natural-completion run | One save, grounded report, correct ending/credit result and verified provider closure |

Run representative fresh-profile checks on Chrome, Edge, Firefox and Safari desktop, then supported iOS Safari and Android Chrome. Include Bluetooth/output changes, keyboard-only interaction and 200% zoom. Record each result as automated, simulated UI, owner-observed, recording-reviewed, failed or not run. Never infer real audible success from a meter, provider event, successful play promise or screenshot alone.
