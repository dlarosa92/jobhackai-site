# Voice, attribution and retention disclosure review

This change corrects factual gaps in Privacy, Cookies and Help and adds a working Cookie Preferences control on the cookie page. It discloses the voice audio/provider path, retained text and feedback, identified optional analytics, consented campaign-to-collected-payment association, Clarity replay, withdrawal/sync behavior, and provider processing outside a promised single country. It does not claim legal certification or zero provider retention.

The 90-day content standard is preserved, with existing pinned LinkedIn, reused-resume and expired-voice-metadata exceptions stated explicitly. Inspection also found that the expired voice metadata carve-out retained supplied role/job context after stripping transcript/feedback. The worker now clears `role`, `seniority` and `jd_excerpt` too, including already-stripped reports. The privacy export still returns content actually retained; this change does not hide retained content from exports.

## Evidence

- A review finding exposed a network-dependent preference button. The shared consent script now attaches its handler before pending writes or server reads. Fifty-nine consent/blog/directory tests pass, including stalled reads/writes and late-grant rejection races.
- Six actual-worker/real-SQLite tests cover nonmutating audit, scoped expiration, preserved recent/pinned/reused data, reruns, existing partial stripping and failure paths.
- Wrangler QA dry run verifies the existing QA D1/KV bindings and `RETENTION_MODE=audit`. No live record deletion was enabled or run.
- Local desktop and 375px iframe review confirmed readable policy text, a contained consent dialog, and working save/reopen controls. This is not a native-device test.
- Local browser cookie policy renders the new disclosure and its button opens Cookie Preferences after rejection. A static local server cannot persist consent to D1; the expected sync-pending notice was visible.
- Clarity lifecycle/masking must ship with PR899. Real SDK0.8.70 synthetic receipt, stop and masking evidence is in `docs/consent-runtime-review.md`.

## Current release follow-up, October 31, 2026

The owner has resumed the staged retention and IT release. Before production publication: set actual effective/updated dates consistently, verify the production worker revision/schedule and approved deletion mode with a reviewed current audit, verify inactive-account cleanup, complete authenticated export/deletion/cancellation checks, and verify provider configuration. Publishing the draft does not prove these gates. The staged policy revision is dated October 31, 2026. If production publication occurs later, refresh the date through the same staged process before publication.

The earlier Firebase-first, best-effort deletion finding is superseded in the current source by the durable deletion processor. The API returns 202 while work is pending and reports completion only after the processor confirms it. Migration 028 is present in development, QA and production. This source correction does not prove live earlier-deletion or recovery behavior; those need deployed acceptance. The production inactivity worker is still an older deployment and must be verified separately before claiming its newer recovery behavior is live. No user account was deleted during this review.

## Primary sources checked September20,2026

- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data): API training defaults and separate provider retention. No account-specific zero-retention setting is asserted.
- [Cloudflare D1 locations](https://developers.cloudflare.com/d1/configuration/data-location/): a location hint is not a guaranteed processing jurisdiction across services.
- [Microsoft Clarity disclosures](https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure): disclose session replay/heatmaps and link the provider's privacy statement; tailor claims to the actual configuration.
