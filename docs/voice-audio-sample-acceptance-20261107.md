# Audio sample isolation, November 7, 2026

## Observed development failure

The recorded Safari check on development revision `8e31b6d` captured an
`output_audio_buffer.cleared` event while microphone speech was arriving.
The provider had acknowledged `interrupt_response: false` and
`create_response: false`. The sample had finished generating, but playback
was cut short. The application had not sent a cancel or buffer-clear event.
This establishes the playback interruption; it does not establish why the
provider cleared the buffer despite the acknowledged configuration.

The owner confirmed clicking Start. The subsequent interview was not an
automatic activation defect. That short session was saved and its provider
connection was independently confirmed closed. Raw recording and traces are
kept outside this repository.

## Change

1. Pause microphone transmission before setup connects and during each sample.
   Enable it for the microphone check after the full sample plays.
2. Require successful generation and a matching playback-stop receipt before
   Start can be enabled. A buffer clear invalidates the sample and offers replay.
3. Preserve the user mute choice, exclude delayed sample-period speech from
   microphone proof, and ignore old playback receipts during a newer sample.
4. Close a setup attempt if playback completion never arrives. Keep interview
   interruptions, explicit Start, server activation and credit handling intact.
5. Update both copies of the spoken instructions and the page status text so
   the user listens first and speaks afterward.

## Development acceptance still required

Automated regression coverage is not listening acceptance. Promote through
the ordinary development CI path, then capture the exact deployed candidate:

- Listen to a complete Safari sample, speak only after the microphone prompt,
  and confirm that setup does not spend a credit.
- Repeat with speech during the sample and with replay/mute toggles. The full
  sentence must play, and the microphone must work afterward.
- Cancel setup and verify provider closure. No official interview is needed
  for those checks.
- Complete the outstanding quiet Safari interview, report reopening and
  controlled background-speech/recovery checks from the current human record.

Development acceptance precedes QA promotion. Production remains a separate
release decision. This change does not resolve the earlier independent
uncertain provider-closure record.
