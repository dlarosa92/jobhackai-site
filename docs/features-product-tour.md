# Features product tour

## Design

The homepage introduces the product; Features lets visitors inspect the experience. The tour opens on the voice conversation, with keyboard-accessible tabs for setup and feedback. A coaching example and four preparation-tool previews show concrete output instead of repeating a general feature list. The page uses the shared Inter, slate, green, border, and button tokens with scoped responsive styles. The outlined briefcase and uppercase wordmark remain intact.

Product captures open in a native dialog. Narrow screens can scroll the full-size capture horizontally. With JavaScript disabled, every scene remains visible and the enlargement links open the image directly. No microphone, voice session, or generation runs on this marketing page.

Free and paid access are distinguished beside the relevant visuals and in the access comparison. Preparation-tool miniatures are illustrative output examples, not screenshots of authenticated customer data. The homepage is unchanged.

## Validation

- Marketing production build, generated Markdown check, and shared asset consistency pass.
- Existing marketing Markdown suite: 24 passing tests. Existing consent, analytics, blog CTA, and directory suites: 184 passing tests.
- Chromium desktop/mobile inspection; keyboard arrows, Home/End, wrapping between tabs, dialog Escape/focus restoration, screenshot zoom, and no-JavaScript fallback checked against the local candidate.
- The static preview server does not implement `/api/cookie-consent`. Initial checks observed its expected 404/501 responses. Final presentation screenshots stub only that endpoint with analytics rejected; no production consent or analytics is used.
- Every preparation-tool destination exists in the repository. Asset dimensions, generated discovery content, JavaScript syntax, and whitespace checked.

## Git and promotion

Created `codex/features-product-tour-20261121` from fetched `origin/dev0` at `653b61db`. Pipeline: `dev0 → develop → main`. The original detached checkout and unrelated modifications are preserved.

At the November 21, 2026 check, remote `dev0` and `develop` had 291/209 unique commits; `develop` and `main` had 190/232. The main checkout contained 24 tracked modifications and 646 untracked entries. This feature does not reconcile unrelated branch history.

Production already had a newer Features page absent from both lower environments. The redesign preserves its `voice_features_01` asset identifier, voice-focused access claims, navigation cache references, footer, canonical, and signup CTA identifiers. Production's favicon/touch-icon filenames do not exist in the marketing asset tree, so this page points to the existing canonical icon. The draft PR targets `dev0`; promotion must review the scoped Features diff and regenerate branch-local Markdown indexes so production-only content survives. No environment branch is merged by this task.

## Product screenshot capture

Captured on November 21, 2026 from the voice interface at `653b61db` (`origin/dev0` at capture time). The corresponding production `origin/main` interface uses the same voice markup and styling; its only differences in `voice-interview.html` are script cache versions. `js/voice-interview.js` has no difference between those refs.

The three images in `marketing/assets/features/` are browser-rendered screenshots of the actual product components populated with synthetic Product Manager demo content. They are not screenshots of a customer session and are not AI-generated images. Label them as **product screenshots with example content** on the public page. Feedback shows the **paid full report** interface; the first free interview includes a strength and an improvement area, not the full report and transcript.

| Asset | Pixel dimensions | Source |
| --- | --- | --- |
| `voice-setup.png` | 1640 × 1334 | Actual `#vi-setup-view` markup from `voice-interview.html`, with Product Manager, Mid, and a sample onboarding job description. |
| `voice-conversation.png` | 1640 × 1062 | Actual `#vi-live-view` markup, with a sample prioritization follow-up and candidate answer; timer fixed at 14:32 for illustration. |
| `voice-feedback.png` | 1640 × 1512 | Markup and classes matching `renderFullFeedback`, `summaryPdfHtml`, and `savedLine` in `js/voice-interview.js`. Synthetic coaching follows the same onboarding example. Expandable details remain closed as in the initial product view. |

Capture method: extract the voice page's inline component CSS, `css/tokens.css`, and `css/main.css` into an offline HTML fixture; embed the repository's Inter Regular and Bold fonts; remove all application scripts; populate the demo values; render the 820 CSS-pixel component at 2× device pixel ratio with Playwright Chromium; take an element screenshot of the whole component. The isolated crop removes page navigation and the exterior shadow and uses a static action bar so nothing is clipped. Component spacing, controls, borders, copy labels, and typography otherwise use the actual product CSS. Setup and conversation markup are extracted directly. Feedback markup mirrors the product renderer, which normally receives authenticated API data.

The fixtures lived temporarily under `/tmp/jobhackai-features-captures-20261121/` and were served only on `127.0.0.1:8767`. They contained no auth script, analytics, remote font request, API call, microphone access, customer data, or real interview session. Do not deploy those fixtures. No live session or account credit was used to make these screenshots.

Avoid adding unsupported UI to these images: the product does not use an animated voice orb or a decorative waveform. Its conversation view consists of an interviewer prompt, the candidate's captured answer, a status/timer, optional answer-structure guidance, and audio/end controls. The question retry control remains unavailable behind a disabled feature flag; do not promote it as a working feature.
