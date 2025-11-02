<!-- e9a2f2c3-2e38-4644-b1f1-d787e18715a2 7d9b8c05-03fb-43af-ac94-ed9e7b2e5c39 -->
# Fix Plan Banner Detection Logic

## Problem

The banner incorrectly shows on `/login` even without a plan parameter because `cameFromPricing` is used to infer a plan selection. The current logic at lines 175-177 is too permissive:

```js
const selectedPlan = planParam || 
  ((hasValidContext && isFreshSelection) ? storedSelection : null) ||
  ((cameFromPricing || cameFromCheckout) ? storedSelection : null);
```

The third condition triggers banner display based solely on referrer, even without explicit plan selection.

## Solution

Refactor plan detection to only show banner when:

1. An explicit `?plan=` URL parameter exists, OR
2. A valid stored plan exists (with proper validation)

Remove referrer-based inference that causes false positives.

## Implementation

### File: `js/login-page.js`

**Location:** Lines 160-216 (plan detection section)

**Changes:**

1. Replace the permissive plan detection logic (lines 160-191) with stricter validation
2. Only consider plans valid if:

   - `planParam` exists and is non-empty, OR
   - `storedSelection` exists and is valid (with defensive parsing)

3. Remove referrer-based inference (`cameFromPricing`/`cameFromCheckout` fallback)
4. Add defensive null checks for JSON parsing
5. Add clear console logging showing which case triggered banner logic
6. Ensure banner auto-hides when showing login form (when `authTitle.textContent === 'Welcome back'`)

**Key Changes:**

- Remove `cameFromPricing`/`cameFromCheckout` from plan selection logic
- Add `hasExplicitPlan` boolean check
- Use try-catch for safe JSON parsing of stored plans
- Clear console logs showing detection path

## Validation Steps

- Visiting `/login` → no banner visible
- Visiting `/login?plan=pro` → banner visible  
- Visiting `/pricing-a`, clicking a plan → redirected `/login?plan=pro` → banner visible
- Refreshing `/login` (no param) → banner gone
- Toggling between signup/login → banner hides correctly when switching to login

## Deployment

1. Run Bugbot validation: `node scripts/bugbot-check.js`
2. Build: `cd app && npm ci && npm run build`
3. Deploy: `npx wrangler pages deploy app/out --project-name jobhackai-app-dev --branch dev0 --commit-dirty=true`