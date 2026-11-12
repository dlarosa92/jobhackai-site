# Interview summary PDF

A "Download summary PDF" action on the full voice interview report. It gives
the candidate a short document to keep or share with a coach: what went well,
what to work on, and next practice steps. It is a product feature for every
account that can already see the full report; nothing in it is specific to a
partner, a pilot, or a plan.

## What the user gets

- The button appears in the full report, right after "Your next step" and
  "What worked", both after a live interview and when a report is reopened
  from History.
- The file is a real PDF with selectable text, named like
  `JobHackAI-interview-summary-Customer-Service-Representative-2026-11-08.pdf`.
- Sections, each printed only when the saved report has content for it:
  Overview, What went well, What to work on, For your next practice, Not
  assessed in this session, About this feedback.
- Typical reports fit one US Letter page. Longer feedback flows onto more
  pages with "Page X of Y"; text is never shrunk or cut to fit.

## Where the content comes from

Everything is a fixed selection from the saved report returned by
`GET /api/voice/session/:id` (`js/voice-summary-pdf.js`,
`buildInterviewSummary`). No model is called, nothing is re-scored, and no
sentence of feedback is rewritten.

| Section | Saved fields |
|---------|--------------|
| Overview | `summary` |
| What went well | `topStrength`, then competencies marked `demonstrated` |
| What to work on | `topImprovement` (or the first `saoCoaching` step when there is none), then competencies marked `needs_practice` |
| For your next practice | remaining `saoCoaching` steps |
| Not assessed in this session | names of competencies marked `not_assessed`, labeled as not weaknesses |
| About this feedback | the report's existing limited-evidence note when it applies, `assessmentScope`, and a one-line closing note |

Left out on purpose: scores, the transcript, quoted answers, moment comments,
session and account identifiers, and email addresses.

## Access

The feature adds no entitlement and no endpoint. The summary is available
exactly when the existing report payload says `fullAccess: true` for a real,
unexpired, scored report. That decision is still made only by the session
endpoint, from the signed-in identity and the existing rules (paid session,
active subscription, usable credits, or has ever paid). Credits that were
granted by hand count like any other credits; an email address is never
consulted.

| Report state | Button | If attempted |
|--------------|--------|--------------|
| Full report | Shown | PDF downloads |
| Free (locked) report | Not shown | "available with the full report" |
| Expired, too short, safety-ended, still scoring, deleted | Not shown | A plain message, no file |

On every click the page re-reads the report from the server before building
the PDF, so a report that was deleted, expired, or locked since the page
opened produces a message instead of a file.

A download only issues `GET` requests: one report read, plus the PDF library
and fonts the first time. It cannot start an interview, reserve or spend a
session, change a balance, or reach billing.

## How it is built

- The PDF is assembled in the browser with pdf-lib and fontkit, vendored in
  `js/vendor/` and injected on first use, with Inter from `assets/fonts/`.
  See `js/vendor/README.md` for versions, licenses and checksums. Report
  content never leaves the browser.
- Characters the font cannot draw do not break the export: emoji are
  dropped and other undrawable characters (for example Chinese, Japanese,
  Korean, Arabic or Hebrew text) print as `?`.

## Tests

`npm run test:voice:summary` in `app/` (part of `npm run test:voice`):

- `voice-summary-pdf.test.mjs`: content selection, every unavailable state,
  filenames, and the rendered PDF read back as text (pagination, long
  strings, Unicode, nothing hidden included).
- `voice-summary-client.test.mjs`: the real page script. Where the button
  appears, double clicks, failures and retries, and that only `GET` requests
  are made.
- `voice-summary-access.test.mjs`: the real session route and entitlement
  code over SQLite. Free, pack, subscription, previously paid, hand-granted
  credits at two different balances, a blank email field, another user's
  report, and before/after snapshots proving nothing is written.

## Known limits

- The download uses a blob link. Current desktop browsers and iOS Safari
  save it; some in-app browsers (for example a link opened inside a social
  or mail app) may block downloads.
- Scripts outside Latin, Greek and Cyrillic print as `?` (see above).
