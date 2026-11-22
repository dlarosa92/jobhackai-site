# Features product tour

## Design

The homepage introduces the product; Features lets visitors inspect the experience. The tour opens on the voice conversation, with keyboard-accessible tabs for setup and feedback. Step 03 opens on expanded answer evidence with the overall practice score and colored dimension bars directly below it. Visitors can also switch to the feedback overview. A coaching example and four preparation-tool previews show concrete output instead of repeating a general feature list. The page uses the shared Inter, slate, green, border, and button tokens with scoped responsive styles. The outlined briefcase and uppercase wordmark remain intact.

Product captures open in a native dialog. Narrow screens can scroll the full-size capture horizontally. With JavaScript disabled, every scene remains visible and the enlargement links open the image directly. No microphone, voice session, or generation runs on this marketing page.

Free and paid access are distinguished beside the relevant visuals and in the access comparison. Preparation-tool miniatures are illustrative output examples, not screenshots of authenticated customer data. The homepage layout is unchanged. The shared marketing navigation now preserves its Start Free links when authentication restores a signed-out visitor.

## Validation

- Marketing production build, generated Markdown check, and shared asset consistency pass.
- Existing marketing Markdown suite: 24 passing tests. Existing consent, analytics, blog CTA, and directory suites: 184 passing tests.
- Chromium desktop/mobile inspection; keyboard arrows, Home/End, wrapping between tabs, dialog Escape/focus restoration, screenshot zoom, and no-JavaScript fallback checked against the local candidate.
- The static preview server does not implement `/api/cookie-consent`. Initial checks observed its expected 404/501 responses. Final presentation screenshots stub only that endpoint with analytics rejected; no production consent or analytics is used.
- Every preparation-tool destination exists in the repository. Asset dimensions, generated discovery content, JavaScript syntax, navigation guardrails, and whitespace checked.
- Final step-03 layouts checked at 320, 390, 768, and 1440 pixels, including both report views. The evidence and colored-score images remain visible together, with separate enlargement links.
- `node --test marketing/tests/features-tour-e2e.cjs`: 18/18 passing. `FEATURES_VENDOR_MODE=real node --test marketing/tests/features-tour-e2e.cjs`: 18/18 passing. Both runs have 19 browser fixtures and zero page errors. Real mode downloads actual GA4/Clarity scripts, inspects their serialized requests, and intercepts every collector; it never sends synthetic collection to production.
- Candidate browser CI runs the deterministic suite against checked-out source, not a deployed base branch. Coverage includes all five screenshot previews, nested keyboard tabs, CTA identifiers and plan intent, visitor restoration, verified/unverified navigation, consent accept/reject/revoke/regrant, stale/server consent, attribution, preview/QA isolation, sensitive URLs, no-JavaScript/native-dialog fallbacks, and tracker failures.

## Analytics verification

Deliberate, consented tour actions emit `features_tour_step`, `features_report_view`, and `features_screenshot_open`. Initialization and repeat selection do not produce duplicate events. Parameters contain controlled step/view identifiers and interaction type, never example answers or screenshot URLs. The score enlargement uses `report_view=scores`. Existing delegated CTA tracking remains `cta_click`, not a signup conversion. Pre-consent tour interactions are not replayed on acceptance.

Browser testing found and fixed two issues: the shared marketing navigation lost its signup actions when authentication restored a signed-out visitor, and Clarity could read sensitive parameters from the document URL even though GA4 sanitized them. The Features page now cleans its URL before the deferred consent loader starts replay, preserving allowed campaign fields and known page anchors. If history replacement fails, replay stays disabled. GA4 still uses its shared sanitizer. The test checks decompressed Clarity envelopes as well as GA requests.

On November 21, 2026 at 23:08–23:11 ET, a separate labeled local candidate session used real vendor collectors with explicit QA destinations. Current owning interfaces verified QA GA4 property `502443078`, stream `12184859894`, measurement ID `G-VH888WWY3M`, and QA Clarity project `yl6ysb5n74`. No analytics settings were changed. GA4 DebugView received one page view, the exact `features_evidence_20261121_receipt_01` correlation marker, a feedback step event, both report views, and a screenshot-open event. Clarity showed the matching live session, candidate page, and four-click timeline. After consent was revoked, further tour clicks produced zero new collection requests.

This receiving-account check confirms actual QA ingestion separately from the intercepted tests. It preceded the added score image; the final real-script regression verifies the new `scores` event and all five images. Processed reports, signup/billing backend flows, production deployment, and persistent recording availability are outside this check. The local auth/consent endpoints were fixtures. The full local receipt is saved with the task's review artifacts as `analytics-receiver-receipt-20261122.md`.

## Git and promotion

Created `codex/features-product-tour-20261121` from fetched `origin/dev0` at `653b61db`. Pipeline: `dev0 → develop → main`. The original detached checkout and unrelated modifications are preserved.

At the November 21, 2026 check, remote `dev0` and `develop` had 291/209 unique commits; `develop` and `main` had 190/232. The main checkout contained 24 tracked modifications and 646 untracked entries. This feature does not reconcile unrelated branch history.

Production already had a newer Features page absent from both lower environments. The redesign preserves its `voice_features_01` asset identifier, voice-focused access claims, navigation cache references, footer, canonical, and signup CTA identifiers. Production's favicon/touch-icon filenames do not exist in the marketing asset tree, so this page points to the existing canonical icon. The draft PR targets `dev0`; promotion must review the scoped Features diff and regenerate branch-local Markdown indexes so production-only content survives. No environment branch is merged by this task.

## Product screenshot capture

Captured on November 21, 2026 from the voice interface at `653b61db` (`origin/dev0` at capture time). The corresponding production `origin/main` interface uses the same voice markup and styling; its only differences in `voice-interview.html` are script cache versions. `js/voice-interview.js` has no difference between those refs.

The five images in `marketing/assets/features/` are browser-rendered screenshots of the actual product components populated with synthetic Product Manager demo content. They are not screenshots of a customer session and are not AI-generated images. Label them as **product screenshots with example content** on the public page. Feedback shows the **paid full report** interface; the first free interview includes a strength and an improvement area, not the full report and transcript.

| Asset | Pixel dimensions | Source |
| --- | --- | --- |
| `voice-setup.png` | 1640 × 1334 | Actual `#vi-setup-view` markup from `voice-interview.html`, with Product Manager, Mid, and a sample onboarding job description. |
| `voice-conversation.png` | 1640 × 1062 | Actual `#vi-live-view` markup, with a sample prioritization follow-up and candidate answer; timer fixed at 14:32 for illustration. |
| `voice-feedback.png` | 1640 × 1512 | Markup and classes matching `renderFullFeedback`, `summaryPdfHtml`, and `savedLine` in `js/voice-interview.js`. Synthetic coaching follows the same onboarding example. Expandable details remain closed as in the initial product view. |
| `voice-evidence.png` | 1640 × 954 | Expanded “Evidence and limits of this feedback” section using the exact `renderFullFeedback` markup structure, status label mapping, and product CSS. The same synthetic PM answer supports a “Communicating impact · Needs practice” example, scoped assessment text, quoted evidence, coaching, and an interview moment. |
| `voice-scores.png` | 1640 × 712 | Expanded practice-score section generated by the exact current `practiceDetailsHtml` and `dimensionRow` functions, rendered with the actual product CSS. Illustrative overall 72; Communication 82, Answer structure 74, Content depth 62, Role fit 70. |

Capture method: extract the voice page's inline component CSS, `css/tokens.css`, and `css/main.css` into an offline HTML fixture; embed the repository's Inter Regular and Bold fonts; remove all application scripts; populate the demo values; render the 820 CSS-pixel component at 2× device pixel ratio with Playwright Chromium; take an element screenshot of the whole component. The isolated crop removes page navigation and the exterior shadow and uses a static action bar so nothing is clipped. Component spacing, controls, borders, copy labels, and typography otherwise use the actual product CSS. Setup and conversation markup are extracted directly. Feedback markup mirrors the product renderer, which normally receives authenticated API data.

The fixtures lived temporarily under `/tmp/jobhackai-features-captures-20261121/` and were served only on `127.0.0.1:8767`. They contained no auth script, analytics, remote font request, API call, microphone access, customer data, or real interview session. Do not deploy those fixtures. No live session or account credit was used to make these screenshots.

Avoid adding unsupported UI to these images: the product does not use an animated voice orb or a decorative waveform. Its conversation view consists of an interviewer prompt, the candidate's captured answer, a status/timer, optional answer-structure guidance, and audio/end controls. The question retry control remains unavailable behind a disabled feature flag; do not promote it as a working feature.

The evidence image was captured as a separate component crop on November 21, 2026, using the same offline fixture method and 2× browser rendering. It illustrates an expanded section of the paid report, with both quotes copied exactly from the synthetic conversation shown in `voice-conversation.png`. It adds no new product controls or numeric claims and preserves the existing full-report screenshot.

The score image was captured on November 21, 2026 at 2× using the same isolated browser fixture. Its numbers are manually selected illustrative values, not scores produced from a real interview or a model evaluation of the sample text. The product’s actual dimension color thresholds are preserved: green at 70 or above, amber from 40 through 69, and red below 40. Caption this image as **illustrative example scores**, not an actual scored session, customer result, hiring prediction, or guarantee. The optional answer-content breakdown is omitted from this crop to keep the score panel compact. No previous-session comparison is shown.

## Production promotion validation (November 22, 2026)

The production candidate preserves main's newer signup (`mode=signup`), plan allowances, header breakpoint, mobile-menu handling, consent implementation, build/routing, existing CI tests, and no-live-payment test rule. It adds only the intended visitor-action restoration to production navigation. The Features implementation matches the approved QA candidate, including the canonical published walkthrough URL. Discovery content is regenerated against all 109 production pages; only the Features entry changes.

On the production base, all 290 existing marketing/regression tests pass (25 Markdown plus 265 consent/tracking/directory/partner-kit/reset tests), as do all 18 browser scenarios in each of fixture and real-vendor-script modes. The navigation browser assertion checks production's signup-mode URL and retains the same free-plan intent/storage assertions. Production telemetry is intercepted in these tests.
