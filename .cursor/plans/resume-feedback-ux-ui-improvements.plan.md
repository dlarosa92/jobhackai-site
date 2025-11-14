# Resume Feedback UX/UI Improvements

## 1. Remove Fake Default Data
**File:** `resume-feedback-pro.html` (lines 2421-2427)

- Remove hardcoded SVG values: `stroke-dashoffset="49"` and `78%` text
- Set initial state: `display: none` on `.rf-progress-ring` until real data loads
- Update `updateProgressRing()` to show ring only when valid score exists

## 2. Fix Page Stickiness (Last Resume Feedback Persistence)
**Files:** 
- `resume-feedback-pro.html` (lines 1323-1400)
- `js/state-persistence.js` (verify `saveLastAtsAnalysis` is called)

- Verify `loadCachedATSScore()` is called on page load (line 1499)
- Ensure `saveLastAtsAnalysis()` is called after successful feedback (check lines 1577-1642)
- Add fallback: if localStorage fails, try KV via `/api/ats-score-persist`
- Hide placeholder when cached data exists

## 3. Implement Proper ResumeFeedbackMeter Component
**File:** `resume-feedback-pro.html` (replace lines 923-985)

### 3.1 Circular Progress Meter
- Create SVG circular progress meter (similar to ATS score ring)
- Calculate progress: `(used / limit) * 100` for percentage
- Use stroke-dasharray/stroke-dashoffset for visual progress

### 3.2 States & Microcopy
- **0/3 Used (Green):** "You have 3 AI feedback reports this month."
- **2/3 Used (Yellow):** "1 more AI feedback remaining this month."
- **3/3 Used (Red/Locked):** 
  - Lock icon in center (use design system SVG)
  - "Feedback Limit Reached — Upgrade to Pro for unlimited use."
  - 80% opacity on entire tile
  - Upgrade button

### 3.3 Design System Icons
- Replace emoji 🔒 with lock SVG (pattern from `dashboard.html` line 1354)
- Replace emoji ⚡ with clock/cooldown SVG icon
- Use consistent 24x24 viewBox, 2px stroke-width

## 4. Update /api/usage Endpoint
**File:** `app/functions/api/usage.js` (lines 62-136)

- Replace manual KV reads with `usage-tracker.js` functions:
  - Use `getUsageForUser()` instead of direct KV access
  - Use `checkFeatureAllowed()` to get limit/used
  - Use `getCooldownStatus()` for cooldown seconds
- Return format: `{ plan, feature, limit, used, cooldownSecondsRemaining }`
- Ensure consistency with `resume-feedback.js` and `ats-score.js` usage tracking

## 5. Add Initial Usage Tile Rendering on Page Load
**File:** `resume-feedback-pro.html` (lines 2320-2375)

**IMPORTANT: Remove old implementation first**

- **Remove the existing code block** (lines 2320-2375) that:
  - Uses `window.renderUsageIndicator` (wrong component)
  - Only shows for essential/trial plans (line 2326)
  - Uses `localStorage.getItem('firebase-id-token')` (wrong token source)
  - Creates separate container instead of using existing `#usage-strip`

- **Replace with new `initializeUsageTile()` function** that:
  - Calls `getAuthToken()` instead of localStorage
  - Fetches usage via `/api/usage` (which will use new usage-tracker.js system)
  - Calls `renderResumeFeedbackUsageTile()` (correct component)
  - Works for ALL plans (free shows locked, pro/premium show unlimited)
  - Renders into existing `#usage-strip` container
  - Includes cooldown status from API response

- **Call on `DOMContentLoaded`** after navigation system ready (similar to line 1178)

## 6. Fix Token Fetching
**File:** `resume-feedback-pro.html` (line 2329)

- Replace `localStorage.getItem('firebase-id-token')` with `getAuthToken()`
- Add error handling for token fetch failures
- Retry logic if token expires during fetch

## 7. CSS Updates
**File:** `resume-feedback-pro.html` (lines 325-340)

- Add `.usage-tile--locked { opacity: 0.8; }` for locked state
- Update `.usage-meter` to support circular progress SVG
- Add styles for lock icon positioning in center of meter
- Ensure cooldown chip uses proper icon styling

## Testing Checklist
- [ ] Fake 78% data hidden on page load
- [ ] Last resume feedback loads on return visit
- [ ] Usage meter shows correct states (0/3, 2/3, 3/3)
- [ ] Lock icon appears when limit reached
- [ ] Microcopy messages match spec
- [ ] 80% opacity applied when locked
- [ ] Cooldown shows design system icon (not emoji)
- [ ] Usage tile renders on page load for all plans
- [ ] `/api/usage` returns data matching usage-tracker.js
- [ ] Old `window.renderUsageIndicator` code is completely removed

