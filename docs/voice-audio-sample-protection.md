# Audio-check sample interruption protection

Safari acceptance on November 3, 2026 reported two truncated test samples, including a replay after microphone mute, followed by one complete sample. This is failed consistency acceptance. No interview activation occurred. The exact live cause, particularly the muted replay, is not established by the available screenshots and human observations.

## Confirmed defects and scope

The client configured semantic VAD with interrupt_response=true during the uncharged hearing check. Detected speech could therefore cancel the very sample the user was asked to listen to. Managed provider calls also started with default automatic responses before the browser configuration acknowledgement.

Managed provider calls now start with create_response=false and interrupt_response=false. The client waits for the effective phase configuration before generating audio. Setup keeps transcription for microphone readiness and explicit cancellation, but protects sample playback from VAD interruptions. Start restores interrupt_response=true with automatic replies still disabled, and requires that setting plus the interview instructions in the provider acknowledgement before requesting chargeable activation.

A lost Start configuration receipt can leave provider settings changed. Replay now restores and acknowledges setup protection before requesting another sample. New and replacement connections configure their actual setup/interview phase. Normal interview barge-in, turn budgets, ownership, deadlines, usage and Finish behavior are retained. No database migration or deadline-worker change is needed.

OpenAI reference: https://developers.openai.com/api/docs/guides/realtime-conversations (Keep VAD, but disable automatic responses; Interruption and Truncation).

## Validation

- Three new client regression cases failed against the old code, then passed: setup configuration acknowledgement, activation acknowledgement before credit, and replay after a lost Start receipt.
- Two additional cases cover reconnect before and after activation without a second activation.
- Provider request payload test verifies passive configuration before the SDP answer is delivered.
- Focused client, turn-budget and provider tests passed (159 before the additional reconnect cases).
- Final managed client and managed server suites passed (131 tests).
- Full npm run test:voice and npm run build passed.
- Native Safari local simulation completed Check audio, Play again and Start, reaching the first question. Synthetic media/auth/HTTP only; it does not prove audible quality.

## Remaining human acceptance

On the deployed development candidate, reload Safari. Check audio, say Testing my microphone, then listen. Confirm the full sample completes. Select Mute mic, then Play again twice, allowing each sample to finish. Both must play fully. Cancel audio check and confirm the balance is unchanged. Only after that passes, restore the microphone and perform the quiet live interview and reply-recovery acceptance separately. QA and production promotion remain gated on their own acceptance.
