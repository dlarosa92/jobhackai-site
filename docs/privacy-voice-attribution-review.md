# Voice, attribution and retention disclosure review

This change corrects factual gaps in Privacy, Cookies and Help and adds a working Cookie Preferences control on the cookie page. It discloses the voice audio/provider path, retained text and feedback, identified optional analytics, consented campaign-to-collected-payment association, Clarity replay, withdrawal/sync behavior, and provider processing outside a promised single country. It does not claim legal certification or zero provider retention.

The 90-day content standard is preserved, with existing pinned LinkedIn, reused-resume and expired-voice-metadata exceptions stated explicitly. Inspection also found that the expired voice metadata carve-out retained supplied role/job context after stripping transcript/feedback. The worker now clears `role`, `seniority` and `jd_excerpt` too, including already-stripped reports. The privacy export still returns content actually retained; this change does not hide retained content from exports.

## Evidence

- Six actual-worker/real-SQLite tests cover nonmutating audit, scoped expiration, preserved recent/pinned/reused data, reruns, existing partial stripping and failure paths.
- Wrangler QA dry run verifies the existing QA D1/KV bindings and `RETENTION_MODE=audit`. No live record deletion was enabled or run.
- Local browser cookie policy renders the new disclosure and its button opens Cookie Preferences after rejection. A static local server cannot persist consent to D1; the expected sync-pending notice was visible.
- Clarity lifecycle/masking must ship with PR899. Real SDK0.8.70 synthetic receipt, stop and masking evidence is in `docs/consent-runtime-review.md`.

## Publication gates

Production policy publication remains held. Before publication: set actual effective/updated dates consistently, verify the production worker revision/schedule and approved deletion mode with a reviewed current audit, verify inactive-account cleanup, complete authenticated export/deletion/cancellation checks, and verify provider configuration. Publishing the draft does not prove these gates. The old March8 dates are retained solely to avoid falsely claiming a new effective policy during preparation.

The existing account-deletion handler removes Firebase first and then treats billing/data cleanup as best effort. Failed cleanup can leave the user unable to retry and still returns success; this is an unresolved implementation issue, not cured by the revised copy. No live account was deleted in this review.

## Primary sources checked September20,2026

- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data): API training defaults and separate provider retention. No account-specific zero-retention setting is asserted.
- [Cloudflare D1 locations](https://developers.cloudflare.com/d1/configuration/data-location/): a location hint is not a guaranteed processing jurisdiction across services.
- [Microsoft Clarity disclosures](https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure): disclose session replay/heatmaps and link the provider's privacy statement; tailor claims to the actual configuration.
