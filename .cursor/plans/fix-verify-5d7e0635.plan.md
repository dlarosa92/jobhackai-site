<!-- 5d7e0635-54ce-4089-ab99-27cfe456a47f 837ff527-1b3a-49bc-bbbe-b0d30035a74f -->
# Fix Verify Redirect Loop - Cache Bust + Clean Build

## Problem Statement

The code changes from the previous deployment are **correct** (isAuthSpecialPage() exists in firebase-auth.js and navigation.js), but Cloudflare may be serving cached versions or the build output may contain stale files. This causes ERR_TOO_MANY_REDIRECTS on `/auth/action`.

## Root Cause

1. Script tags in `auth/action/index.html` lack version parameters, allowing browser/CDN caching
2. The `postbuild` script doesn't clean `out/js` and `out/css` before copying, potentially leaving stale files
3. Browsers and Cloudflare edge cache may serve old JS even after deployment

## Solution Overview

Add cache-busting version parameters to all script tags and ensure clean build output by removing old JS/CSS before copying fresh files.

## Implementation Steps

Step 0: Run Bugbot pre-check

Run from the repository root:

node scripts/bugbot-check.js

Expected: 13/13 passed (Build static export, Auth guards, Stripe webhook, Functions, KV, Postbuild). If any fail, fix before proceeding.

### Step 1: Add Cache-Busting Parameters to auth/action/index.html

**File: `auth/action/index.html`**

**Current (lines 169-174):**

```html
<script src="/js/firebase-config.js"></script>
<script src="/js/firebase-app.js"></script>
<script src="/js/firebase-auth.js"></script>
<script src="/js/auth-action.js" defer></script>
<script src="/js/navigation.js?v=20251007-2" defer></script>
<script src="/js/redirect-tracer.js?v=1" defer></script>
```

**Change to:**

```html
<script src="/js/firebase-config.js?v=20251101"></script>
<script src="/js/firebase-app.js?v=20251101"></script>
<script src="/js/firebase-auth.js?v=20251101"></script>
<script src="/js/auth-action.js?v=20251101" defer></script>
<script src="/js/navigation.js?v=20251101" defer></script>
<script src="/js/redirect-tracer.js?v=20251101" defer></script>
```

**Purpose:** Forces browsers and CDN to fetch new JS files instead of using cached versions.

### Step 2: Update postbuild to Clean Output Directory

**File: `app/package.json`**

**Current (line 9):**

```json
"postbuild": "cp -f public/_redirects out/_redirects && cp -f public/_headers out/_headers && mkdir -p out/auth && cp -f ../auth/action/index.html out/auth/action.html && cp -r ../*.html out/ && cp -r ../css out/ && cp -r ../js out/ && cp -r ../assets out/"
```

**Change to:**

```json
"postbuild": "rm -rf out/js out/css && cp -f public/_redirects out/_redirects && cp -f public/_headers out/_headers && mkdir -p out/auth && cp -f ../auth/action/index.html out/auth/action.html && cp -r ../*.html out/ && cp -r ../css out/ && cp -r ../js out/ && cp -r ../assets out/"
```

**Purpose:** Ensures no stale JS/CSS files remain in the build output that could be deployed to Cloudflare.

### Step 3: Optional - Add Defensive Type Check to firebase-auth.js

**File: `js/firebase-auth.js`**

**Current (line 808):**

```javascript
if (isAuthSpecialPage()) {
```

**Optional change to:**

```javascript
if (typeof isAuthSpecialPage === "function" && isAuthSpecialPage()) {
```

**Purpose:** Adds extra safety in case of load order issues. This is optional since the current code already works correctly.

### Step 4: Build and Deploy

Run the following commands from the `app` directory:

```bash
cd app
npm run build
npm run predeploy
npm run test:auth
npm run deploy:qa
```

**What happens:**

- `npm run build`: Next.js builds the static site
- `postbuild` (auto): Removes old JS/CSS, copies fresh files including updated auth/action.html
- `npm run predeploy`: Verifies auth artifacts exist
- `npm run test:auth`: Tests for redirect loops (may show 308 for custom domain, that's expected)
- `npm run deploy:qa`: Deploys to dev0 branch on Cloudflare Pages

### Step 5: Verification

After deployment completes:

1. **Check deployment URL**: Note the Cloudflare Pages preview URL from the deploy output (e.g., `xyz.jobhackai-app-dev.pages.dev`)

2. **Test the auth action page** (use incognito/private window):
   ```
   https://dev.jobhackai.io/auth/action?mode=verifyEmail&dummy=1
   ```


   - Should load once with "Verifying your email..." message
   - Should NOT show ERR_TOO_MANY_REDIRECTS
   - DevTools Network tab should show 1-2 requests max, not infinite loop

3. **Verify new JS is served**:
   ```bash
   curl "https://dev.jobhackai.io/js/firebase-auth.js?v=20251101" | grep "isAuthSpecialPage"
   ```


Should return the function definition

4. **Check for redirect loop in DevTools**:

   - Open DevTools → Network → Preserve log
   - Visit the auth action URL
   - Should see at most: one 308 redirect + one 200 OK
   - Should NOT see repeating `/auth/action` → `/verify-email` → `/auth/action` chain

## Expected Results

✅ No ERR_TOO_MANY_REDIRECTS on `/auth/action`

✅ Email verification links work correctly

✅ Password reset links work correctly

✅ Fresh JS files deployed with cache-busting version params

✅ Clean build output without stale files

✅ Unverified users still redirected to verify-email (but no loop)

## Files Modified

1. `auth/action/index.html` - add `?v=20251101` to all 6 script tags
2. `app/package.json` - prepend `rm -rf out/js out/css &&` to postbuild
3. `js/firebase-auth.js` - optional defensive type check (line 808)

## Notes

- The previous implementation already has the correct `isAuthSpecialPage()` logic
- This fix addresses deployment/caching issues, not code logic issues
- The 308 redirect from `/auth/action` to `/auth/action.html` is normal Cloudflare Pages behavior
- Cache-busting params can be updated to any unique value (date-based is common)
- If issues persist after this, consider adding Cloudflare cache purge (requires API credentials)

## Troubleshooting

If redirect loop persists after deployment:

1. Check if custom domain `dev.jobhackai.io` points to the correct branch deployment in Cloudflare Pages dashboard
2. Test with the direct Cloudflare Pages URL (from deploy output) to isolate custom domain issues
3. Clear browser cache completely or test in fresh incognito window
4. Verify the deployed `firebase-auth.js` actually contains the new code by viewing

### To-dos

- [x] 
- [x] 
- [x] 