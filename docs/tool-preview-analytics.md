# Tool preview measurement

The LinkedIn Optimizer, Interview Questions, and Resume Feedback examples use
the existing `js/cookie-consent.js` loader and its delegated CTA tracker.
`js/tool-preview-telemetry.js` must occur once, before the deferred consent
loader. The tool page explicitly registers its preview after its access decision.

| Event | Meaning | Bounded context |
| --- | --- | --- |
| `sign_up_gate_view` | At least half of the current example heading is visible while analytics is allowed. Once per document. | `asset_id`, `page_path`, `business_line`, `tool`, `page`, `preview_type=illustrative` |
| `cta_click` | One deliberate signup or login link activation, only while analytics is allowed. | Existing `cta_label`, `page_path`, `asset_id`, plus `action=signup` or `action=login` |
| `tool_output_viewed` | Existing ready-output check also passes viewport visibility and current consent. Once per document. | `tool`, `page_path`, `business_line`, existing page `asset_id` |
| `page_view` | Existing consent loader owns the event and deduplicates the app/fallback paths. | Existing sanitized URL, attribution and asset context |

These click and preview events do not imply that an account was created or a
purchase occurred. The owning authentication/billing flows retain those events.
No new parallel CTA listener or vendor loader is introduced.

## Reporting

The page assets are `tool_preview_linkedin_optimizer`,
`tool_preview_interview_questions`, and `tool_preview_resume_feedback`.
The existing `asset_id` and `page_path` GA4 dimensions distinguish the tool;
the existing `action` dimension distinguishes signup from login clicks. That
dimension currently has the display name “Partner kit action”; filter by these
asset IDs when building tool reports. `business_line=career_product` matches
the existing blog CTA convention. Preview `page_path` uses the canonical
`.html` tool route; the shared CTA tracker uses the actual pathname.

`tool`, `cta_label`, and `preview_type` are bounded event parameters, but are
not currently registered custom dimensions. They remain available in event
payloads/DebugView; standard report breakdowns require registration. This change
does not modify GA4 settings. Compare consented preview views with consented
CTA actions by asset. A click/view ratio can exceed 100% because repeated
deliberate clicks are retained while impressions are deduplicated.

## Consent and privacy

- Preview views and opted-in CTA clicks never enter the pre-decision queue.
  Consent grant rechecks the current connected, visible preview, so a preview
  hidden by restored authentication does not become a stale impression.
- Repeated preview signals and consent grants do not duplicate impressions.
  Re-grant notifies visibility consumers even when the GA runtime already exists.
- Reject/revoke stops collection. GA may resume after re-grant; the owning
  consent module keeps Clarity stopped until a new document after revocation.
- All three pages keep `data-clarity-mask="true"` on the body, covering inputs,
  generated output and history. Event parameters contain no entered content,
  email, account ID, auth token, link destination, or arbitrary query value.
- GA continues to use the owning URL/referrer sanitizer. Clarity is suppressed
  before loading when the current URL or referrer is unsafe. Functional tool
  URLs are preserved. Safe campaign slugs, known login mode/plan values and
  an allowlisted tool return path are accepted; unknown query/hash values are not.
- Encoded `_gl` linker state is deliberately preserved for GA and disables
  replay on that document. Its contents cannot be assumed free of private data.
  This limits Clarity coverage for cross-domain handoffs; it does not disable GA.
- The helper does not collect views without IntersectionObserver, or change
  authentication, entitlements, consent storage, or destination isolation.

## Validation

Run `node --test app/tests/ui/tool-preview-telemetry.test.cjs` with the app's
Playwright dependency available. Set `TOOL_TELEMETRY_TEST_BROWSER=webkit` for
the second engine. The 25 cases use real candidate HTML, preview modules and
the complete consent bundle, synthetic auth/API boundaries, and vendor runtime
stubs. Every request is intercepted, including collectors. They verify click
ordering, consent transitions, stale-view suppression, deduplication, masking
attributes, URL handling, environment IDs, handoff preservation and hidden
output placeholders. Stubbed collector payloads validate our event contract;
they do not prove vendor ingestion or Clarity's rendering/masking implementation.
The separate Features serialization suite checks actual vendor runtimes with
collectors intercepted. No live tool analytics is sent by this test suite.
