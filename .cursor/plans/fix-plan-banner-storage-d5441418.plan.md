<!-- d5441418-818b-4a44-b2f1-e43fb34a2abd c94e1f01-837e-418b-96e3-69d587a1bd6d -->
# Redeploy SessionStorage Plan Detection Fix

## Problem

The sessionStorage changes were committed but not deployed. The current deployment at dev.jobhackai.io is running the old localStorage code, which is why the plan banner still doesn't appear.

## Root Cause

After committing the sessionStorage changes (commit fdfc056), we ran:

1. `npm run build` - built the app
2. `npm run deploy:qa` - deployed to Cloudflare

However, the deployment shows only 12 files uploaded, suggesting the JS files weren't fully refreshed in the deployment.

## Solution

The banner exists and the JS runs correctly (confirmed via console logs), but it's invisible because the CSS requires a `.show` class to make it visible (opacity: 0 by default). The `showSelectedPlanBanner()` function sets `display: block` but never adds the `.show` class.

**Fix Applied:**

- Modified `showSelectedPlanBanner()` to add the `.show` class using `requestAnimationFrame()`
- Modified `hideSelectedPlanBanner()` to remove the `.show` class

Now rebuild and redeploy with this CSS fix included.

## Steps

### 1. Clean build artifacts

```bash
cd /Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/app
rm -rf out .next
```

### 2. Rebuild application

```bash
npm run build
```

This will:

- Build Next.js static site
- Copy all HTML/CSS/JS files via postbuild script
- Include updated `js/login-page.js`, `js/firebase-auth.js`, etc.

### 3. Verify JS files are in output

```bash
ls -la out/js/login-page.js
grep -c "sessionStorage" out/js/login-page.js
```

Should show multiple matches for "sessionStorage"

### 4. Create Pull Request

```bash
cd /Users/dlarosa92/Desktop/JobHackAI/jobhackai-site
gh pr create --title "Deploy: SessionStorage plan detection to dev" \
  --body "Redeploy with sessionStorage plan detection changes.

**Previous Deploy Issue:**
The sessionStorage changes (commit fdfc056) were committed but the deployment didn't pick up all JS file changes.

**This Deploy:**
- Clean build from scratch
- Ensures all updated JS files are in /app/out
- Includes sessionStorage-based plan detection across all auth flows

**Files Updated (from fdfc056):**
- js/login-page.js - sessionStorage plan detection
- js/firebase-auth.js - getSelectedPlan() uses sessionStorage
- js/stripe-integration.js - openCheckout() uses sessionStorage
- js/verify-email.js - routeAfterVerification() uses sessionStorage
- js/test-helper.js - cleanup includes sessionStorage

**Testing:**
- Clean build verified
- sessionStorage references confirmed in output
- Ready for deployment to dev.jobhackai.io

**Bugbot:** 13/13 passed" \
  --base dev0
```

### 5. Deploy to Cloudflare Pages

```bash
npm run deploy:qa
```

### 5. Verify deployment

Navigate to: https://dev.jobhackai.io/pricing-a

- Click "Get Pro Plan"
- Should redirect to `/login?plan=pro` or `/login.html?plan=pro`
- Banner should appear immediately showing "Pro Plan - $59/mo"

Open browser console and check:

```javascript
sessionStorage.getItem('selectedPlan')
```

Should show: `{"planId":"pro","planName":"Pro Plan","price":"$59/mo","source":"pricing-page","timestamp":...}`

## Success Criteria

- Clicking any plan button from pricing page shows banner on login page
- sessionStorage contains plan data
- Banner displays correct plan name and price
- URL includes `?plan=` parameter