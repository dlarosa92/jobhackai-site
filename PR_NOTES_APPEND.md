
### Original requirements (from PR request)
- Always fetch `GET /api/ats-score-persist` on dashboard load; render returned score/summary/breakdown in the command-center tile.
- Fall back to existing localStorage/cache only if the D1 fetch fails or returns null.
- Before posting to `/api/ats-score`, clear all cached keys related to ATS scores (e.g. `lastATSScore`, `currentAtsScore`, session/local keys).
- After a successful POST, poll `/api/ats-score-persist` for the newly uploaded resume's score; once confirmed, write the payload to cache and update UI.
- Keep the "Your First ATS Resume" card copy/layout exactly as today (title, description, "First run · X ago", and percentage slot); remove the "Hi there…" fallback sentence and populate score/timestamp dynamically from the fetched history item.
- Upload button visible only to free-account users until a persisted score exists; hide it immediately after a persisted score is confirmed (no new CTA text).
- Guard DOM-manipulating logic so actions only run when relevant elements exist.
- No backend/D1 schema changes — consume existing `/api/ats-score-persist` and `/api/resume-feedback/history` endpoints.

### Bugs found & fixed (summary)
1) Duplicate `loadAtsScoreFromStorage` declaration + merge artifacts
- Problem: Duplicate declarations and leftover merge markers created syntax/structural issues.
- Fix: Consolidated to a single `async function loadAtsScoreFromStorage()` implementation and removed merge artifacts.

2) Commit message or annotation accidentally left in code
- Problem: Literal commit/annotation text previously left in file in two places (caused visible text/syntax errors).
- Fix: Removed stray annotations; validated no occurrences remain.

3) Upload button render condition and duplicate usage indicator
- Problem: Duplicate `usage-indicator` was being appended; upload visibility logic intentionally restricts upload to free users but was correct per requirements.
- Fix: Removed duplicate usage-indicator element. Verified upload visibility remains `user.plan === 'free' && (!atsScore.atsPersisted || atsScore.percent === null)` per spec.

4) Unsafe getCurrentUser usage
- Problem: Code called `getCurrentUser().getIdToken()` without verifying `getCurrentUser()` returned a user object (could be null on expired sessions).
- Fix: Replaced with safe pattern: `const currentUser = window.FirebaseAuthManager?.getCurrentUser?.(); if (!currentUser) { alert(...); return } idToken = await currentUser.getIdToken();` and handled token errors with user-facing messaging.

5) Duplicate `change` upload listeners causing double-posts
- Problem: Two `change` handlers on the same file input could submit twice.
- Fix: Added an `_jhUploadInProgress` guard and ensured both handlers set/clear the flag; removed early opener to avoid duplicate, and added `try/finally` to always clear the flag.

6) New handler registered too late (DOMContentLoaded inside render path)
- Problem: The new upload handler was registered via `document.addEventListener('DOMContentLoaded', ...)` inside `renderDashboard()` (which itself runs after DOMContentLoaded), so the inner listener never executed.
- Fix: Replaced the inner `DOMContentLoaded` wrapper with an IIFE so handlers register immediately when `renderDashboard()` runs.

7) Final polling logic accepted stale D1 results and double-reloaded
- Problem: Final fallback check accepted any D1 score (could be old) and called `window.location.reload()` without returning, causing a double reload.
- Fix: Final check now validates by `resumeId` or `timestamp >= expectedTimestamp` (same as main polling loop). Added `return` after reload to avoid double-reload.

8) Polling matching used Date.now() AFTER POST (race)
- Problem: `expectedTimestamp` fallback used `Date.now()` after POST (client timestamped post) which is later than server's D1 timestamp, so match never succeeded.
- Fix: Capture `expectedTimestampBeforePost = Date.now()` before making the POST and use that for comparisons.

9) New handler lacked file validation and loading state
- Problem: New IIFE handler uploaded files without validating extension/size and didn't call `showLoadingState()` so UI didn't indicate progress.
- Fix: Added same file validation (.pdf/.docx/.txt, <2MB) to the IIFE handler and called `showLoadingState()` before POST.

10) Cached fallback not marking `atsPersisted`
- Problem: When D1 was unavailable but cached score existed, `atsScore.atsPersisted` wasn’t set; upload button erroneously remained visible for free users.
- Fix: When loading a valid cached score, set `atsScore.atsPersisted = true` so visibility logic behaves consistently.

11) Error handling didn't clear file input on network/server failures
- Problem: Network/server errors in new handler didn't clear `event.target.value`, preventing retry of same file.
- Fix: On POST/network failures we now call `hideLoadingState()` and `event.target.value = ''` so users can retry immediately.

12) Double registration/opening bypassed credit checks
- Problem: An early opener `btn.addEventListener('click', input.click())` allowed file dialog to open before credit checks in the original handler.
- Fix: Removed the early opener in the IIFE; left original click handler (which performs billing/credit checks) as the sole opener.

13) Duplicate usage/visual and linter issues
- Problem: Merge conflict left stray code and linter errors.
- Fix: Cleaned up stray code, removed duplicated lines, resolved syntax issues and re-ran lints on `dashboard.html`.

### Where I applied changes
- File: `dashboard.html` (multiple edits, consolidated in branch `dashboard-d1-sync-rebased`)
- Branch: `dashboard-d1-sync-rebased` (commits include fixes; latest commit: 7831258 / b23ba69 / 3d57624 / 2f73036 / 02e8753 / 25a3b0c / c6e297b etc.)

### Recommended follow-ups
- Run browser smoke tests exercising: free-account upload once used credit, successful POST -> D1 persist, fallback when D1 slow, retry after network error, and UI states (button hide/show, loading text).
- Request peer review focusing on the IIFE vs original click handler interplay and the timestamp/resumeId matching strategy.

