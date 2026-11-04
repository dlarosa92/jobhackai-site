# Development audio-cutoff diagnosis

Direct Safari output capture after PR 1156 reproduced a 0.424-second initial sample while the complete caption appeared. Two subsequent replays with the page microphone muted completed. The user was only listening, without competing dictation or voice chat. These observations do not establish whether the provider cleared playback or Safari lost audible output. PR 1156 is not a live acceptance pass.

Open `https://dev.jobhackai.io/voice-interview?voiceAudioDebug=1` to enable a local trace. The flag works only on the exact development hostname or localhost. It is off on QA and production, even if the flag is supplied. The normal interview behavior, provider configuration and entitlement gates are unchanged.

Record Safari output, run Check audio, allow the initial sample to finish, then use Play again. Do not select Start interview. Cancel the audio check and use Save audio diagnostics at the bottom of the page. The download includes relative timing, allowlisted provider event names and effective VAD settings, caption lengths, media-element state, microphone enabled/muted state, page visibility, audio-session state, and numeric incoming WebRTC statistics. It excludes audio, transcript words, prompts, IDs, credentials, SDP, device labels and network addresses. Nothing is uploaded by the diagnostic module. The in-memory trace is capped at 3,000 records; a dropped count identifies incomplete traces. Reloading discards it.

Correlate the recording with provider output-buffer events and incoming audio energy. Generation completion alone is not proof of completed playback. Do not attribute a cutoff to background speech, browser configuration or an OS interruption without matching evidence. Cancelled setup must still leave the interview balance unchanged and its provider call closed.

Validation: diagnostic host/flag gates, content exclusion, bounded storage, listener cleanup, late-stat isolation, and the actual client event/send/teardown path are covered by `voice-audio-diagnostics.test.mjs`. The focused client suites and application build pass. Audible acceptance, QA promotion and production promotion remain pending.
