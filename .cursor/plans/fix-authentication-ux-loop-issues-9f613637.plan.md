<!-- 9f613637-acc9-43fe-80aa-70f4927157a9 a9e04300-d5be-4558-9796-8349ef9b9817 -->
# Complete Authentication & Verification Patch (v2) — Updated With Routing, Banner Keys, and Selectors

## Already Completed (First Deployment)

- ✅ Default title "Welcome back" in login.html
- ✅ safeFallbackInit() and try/catch in login-page.js
- ✅ Logout-intent handling fix (clears flag, doesn't return early)
- ✅ firebase-auth-ready event added
- ✅ requireVerifiedEmail() added and used in dashboard.html
- ✅ Navigation defers init on firebase-auth-ready
- ✅ Committed and deployed to dev0

## Remaining Work

### 1. Create /auth/action Flow (Email Verification + Password Reset)

**Files**: Create `auth/action.html`, `auth/action/index.html` and `js/auth-action.js`

**Routing Fix (Cloudflare Pages)**:

- Add `_redirects` rules to ensure Pages serves static file instead of Next error:
```
# Auth routing
/auth/action /auth/action.html 200
/auth/verify /auth/action.html 200
/auth/reset  /auth/action.html 200
```

- Ensure postbuild copies `_redirects` into `/app/out/_redirects`.

**Requirements**:

- `mode=verifyEmail`: `applyActionCode` → `user.reload()` → set `sessionStorage.emailJustVerified = "1"` → redirect `/dashboard.html` (friendly error + back to login on failure)
- `mode=resetPassword`: Show reset UI (eye toggles), `confirmPasswordReset` → redirect `/login.html` with success banner
- Design system: white card, radius 16px, Inter font, green CTA (#007A30)
- Password strength validation (min 8 chars, uppercase, lowercase, number)

### 2. Email Verification Gating (Security)

**File**: `js/firebase-auth.js`

- Keep `requireVerifiedEmail()` as:
  - Wait for auth ready
  - If no user → `/login.html`
  - If unverified → `/verify-email.html?email=<user.email>`
  - If verified → return true

**Files**: `dashboard.html` (and account pages, if any)

- Call `requireVerifiedEmail()` before rendering any protected content

**File**: `verify-email.html`

- "I’ve already verified" → `currentUser.reload()` then:
  - If `emailVerified` → `/dashboard.html`
  - Else show red error message

### 3. Secure Navigation Initialization (Three States)

**Files**: `js/firebase-auth.js`, `js/navigation.js`

- On `firebase-auth-ready`:
  - Anonymous: show marketing nav (Home/Blog/Features/Pricing/Login/Start Trial)
  - Signed-in but unverified: show minimal header (logo + Logout only); hide Dashboard/Account
  - Signed-in and verified: hydrate full nav and account dropdown
- Do NOT show error modal for missing localStorage on first visit

### 4. Forgot Password Modal (Resilience)

**File**: `js/login-page.js`

- Ensure modal "Send reset link" calls `authManager.resetPassword(email)`
- Inline error handling for quota/4xx; keep success message visible

### 5. Restore Plan Banner (Pricing → Login)

**Session payload written by pricing page**:

```js
// pricing.js
sessionStorage.setItem("selectedPlan", JSON.stringify({
  planId: "pro",            // "free" | "trial" | "essential" | "pro" | "premium"
  planName: "Pro Plan",
  price: "$59/mo",
  source: "pricing-page",
  timestamp: Date.now()
}));
```

**File**: `js/login-page.js`

- On DOMContentLoaded (before any async), synchronously read:
```js
const planData = JSON.parse(sessionStorage.getItem("selectedPlan") || "{}");
if (planData.planName) showSelectedPlanBanner(planData);
```

- Paint banner instantly (green #007A30, DS-compliant), no Firebase wait

### 6. Password Toggle Consistency

**Files**: `js/login-page.js`, `js/auth-action.js`

- Eye toggle on: login password; signup password+confirm; reset password form
- Flip `type="password"` ↔ `type="text"` only (no checkboxes)

### 7. Defensive Redirect Tracer

**File**: `js/redirect-tracer.js`

- Wrap tracer init with try/catch; never break auth redirect flow

### 8. DOM Selectors to Use (for gating/hiding)

- Navigation container: `document.querySelector("nav.nav-links")`
- Account dropdown trigger: `document.querySelector(".nav-dropdown-toggle")`
- Account settings wrapper: `document.querySelector(".account-settings-wrapper")` (or `#account-page` fallback)

### 9. Automated QA Tests (Headless)

Run before deployment:

1. Public landing (fresh): no modal, no uncaught errors; marketing nav visible
2. Pricing → Login: banner paints instantly with green style and correct plan
3. Signup → Verify Email (pre-verification): verify-email page shows minimal header; dashboard/account blocked
4. Email verification: `/auth/action?mode=verifyEmail&...` loads (no 404) and redirects to dashboard on success
5. Password reset: `/auth/action?mode=resetPassword&...` shows form; success returns to login with message
6. Logout: no uncaught TypeError from redirect-tracer; login page interactive

### 10. Build and Deploy to dev0

```bash
cd /Users/dlarosa92/Desktop/JobHackAI/jobhackai-site
git checkout dev0
git add login.html verify-email.html dashboard.html js/login-page.js js/navigation.js js/firebase-auth.js auth/action.html auth/action/index.html js/auth-action.js public/_redirects
git commit -m "fix(auth-secure): gate unverified users, fix /auth/action 404s, stabilize nav init, instant plan banner, silence anon smoke-test modal"
cd app
npm run build
npm run deploy:qa
```

### 11. Post-Deploy Verification

Test on https://dev.jobhackai.io:

- Fresh visitor to /login.html (no errors)
- New signup → verify email → /auth/action works (not 404)
- Unverified → /dashboard.html redirects to verify-email
- Verified → dashboard loads; full nav visible
- Forgot password → /auth/action reset flow works

## Success Criteria

- No 404s on /auth/action routes
- Unverified users cannot access dashboard/account; restricted header enforced
- Navigation initializes without error modal on first visit
- Banner paints instantly and correctly
- All automated QA tests pass
- Deployment successful to dev.jobhackai.io

### To-dos

- [ ] Create /auth/action.html with design system styling
- [ ] Create /js/auth-action.js handling verifyEmail and resetPassword modes
- [ ] Add requireVerifiedEmail() helper to firebase-auth.js
- [ ] Add email verification gate to dashboard.html
- [ ] Fix 'already verified' button in verify-email.html to reload and check
- [ ] Dispatch firebase-auth-ready event in firebase-auth.js
- [ ] Make navigation.js wait for firebase-auth-ready event
- [ ] Verify forgot password modal wiring and error handling
- [ ] Verify plan banner displays when coming from pricing
- [ ] Run automated QA tests for all auth flows
- [ ] Build, commit, and deploy to dev.jobhackai.io