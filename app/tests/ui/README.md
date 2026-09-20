# Free-tool UI regression checks

From `app/`:

```sh
npm ci
npm run test:ui:free-tools
npm run build
npm run test:ui:serve
```

Open `http://localhost:3003/resume-feedback-pro.html?plan=free&state=saved`.
Use `interview-questions.html` for Interview Questions. The fixture accepts
`plan=free|weekly|monthly|pack|trial|essential|pro|premium|visitor`; omit
`state=saved` for an empty resume history.

The server serves the candidate's actual page scripts and styles. It replaces
Firebase identity and HTTP responses with synthetic fixtures; it does not call
remote APIs, change real history, or consume credits. It binds to loopback and
serves only public site assets. Stop it with Ctrl-C.

The Node tests parse the real inline scripts with TypeScript and execute the
relevant declarations in a VM. Only the DOM, auth and HTTP dependencies are
stubbed. They cover role readiness, the mock-practice action, the initial
feedback request, rendering across all eight account plans, restored/saved
copy, sign-out, processing, cooldown and daily-limit guards. They do not claim
to test layout or Firebase sign-in end to end. `UI_SOURCE_ROOT` can point to a
separate checkout for comparison; the original dev0 pages fail ten of the
sixteen IQ-access and initial-feedback-request checks.

Browser acceptance checklist:

- Free: enter a Role, generate questions, star a question, open written practice.
- Resume: fresh form; automatically restored feedback; click a saved history
  entry; generate a rewrite; Start Fresh restores the empty state.
- Visitor: signup/login gate remains visible; generation cannot call an API.
- Weekly, monthly and pack: prep inputs and rewrite controls stay available.
- At 375, 390, 430 and desktop widths, check document width and the bounds of
  inputs, buttons, textareas and history rows. Textareas must fit their parent,
  including padding and borders. Restore any temporary viewport override.

For a real generation check, use only an authorized dev test account and an
isolated candidate surface. The fixture alone is not evidence of a successful
OpenAI request or a deployed change. Keep credentials and test-account evidence
out of source control.
