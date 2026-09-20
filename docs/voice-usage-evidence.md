# Voice usage evidence

Voice prices and model selection are unchanged. Migration 029 must run on the target database before deploying this code. Migration 028 belongs to the separate deletion-recovery draft and is not a prerequisite; execute 029 explicitly rather than applying every pending migration.

The completion endpoint now stores bounded, numeric usage observations in `voice_sessions.usage_details_json`. Response IDs are deduplicated. Realtime responses retain text, audio, image and cached-input counts separately; input transcription retains its separate usage or duration. Audio checks and the spoken ending consume resources and are included even when excluded from the scored transcript. Missing details remain null. Payloads are sanitized again server-side; transcripts, credentials and caller-provided provenance are excluded. At most 512 events are retained; dropped events are counted. Existing token columns contain only observed, deduplicated response totals, not transcription totals.

The report generator also stores the returned model and usage, identifying application-cache results separately. The OpenAI client reads native cached input from `prompt_tokens_details.cached_tokens`, retaining the old field as a compatibility fallback. These records cover the returned response only. Failed or discarded attempts, timeouts and concurrent scoring can incur other costs.

New completions leave `cost_usd` null. Previously this field applied audio rates to all tokens and omitted transcription and report costs. Historical values remain unchanged and must be treated as incomplete legacy estimates. Do not substitute null with zero in financial analysis. No consumer-facing UI reads this field.

The evidence is client-reported for Realtime and may be missing, truncated or manipulated. Reloaded/resumed sessions and abrupt disconnects can lose observations. It is not a complete provider ledger and never controls entitlements, invoices or customer charges. Report usage is observed server-side but is still not provider-bill reconciliation. No claim of validated margin is made by this change.

Usage evidence lives on the existing voice row, so retention and account erasure remove it along with that row. Public session reads and user exports keep their existing explicit field lists. No Analytics event contains this evidence.

## Remaining acceptance

- Verify exact deployed revision, migration, and browser asset delivery in development and QA.
- Inspect a consenting human QA interview's persisted modality/transcription/report evidence. Do not start the microphone unattended.
- Reconcile a bounded test window against provider usage/cost records, including abandoned sessions and report retries. Apply current rates to the exact observed models, modalities and cached counts, with missing coverage explicit.
- Calculate actual per-session cost and plan-level margins before describing unit economics as verified. This telemetry change alone does not close that gate.

Official format references, checked September 20, 2026: [Realtime cost and usage events](https://developers.openai.com/api/docs/guides/voice-latency-cost), [API pricing](https://developers.openai.com/api/docs/pricing). Rate cards are intentionally not hardcoded here.
