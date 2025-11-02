<!-- 5c9e47c1-c444-4bd4-9659-e28d03506cec 5210eab4-a49e-4cad-be4b-d433e3e7b6a2 -->
# Fix Auth Action Redirect Loop - Exclude from Catch-All

## Problem

The `/auth/action` route continues to show `ERR_TOO_MANY_REDIRECTS`. This happens because:

1. `/auth/action` → 301 redirect → `/auth/action.html` (working)
2. `/auth/action.html` is then matched by the catch-all `/* /index.html 200` 
3. This creates a rewrite loop or conflict

The issue is that the catch-all rule `/* /index.html 200` is matching `/auth/action.html` and rewriting it, even though more specific rules should take precedence.

## Root Cause

In Cloudflare Pages, the catch-all `/*` rule can sometimes match paths that have specific rules, especially when the specific rule only redirects rather than serving the file directly. The `/auth/action.html` file needs to be explicitly excluded from the catch-all or served directly without rewrite.

## Solution

Explicitly exclude `/auth/*` paths from the catch-all rule by adding a direct rule for `/auth/action.html` that serves it with a 200 status. This ensures the file is served directly without being rewritten by the catch-all.

## Implementation

### Step 1: Update _redirects to serve auth/action.html directly

**File:** `app/public/_redirects`

Add an explicit rule to serve `/auth/action.html` directly before the catch-all:

```diff
# Auth routing
# Using 301 redirect instead of 200 rewrite to prevent redirect loops
# This explicitly redirects rather than silently rewriting
/auth/action   /auth/action.html   301
/auth/verify   /auth/action.html   200
/auth/reset    /auth/action.html   200

+# Explicitly serve auth/action.html directly to prevent catch-all matching
+/auth/action.html   /auth/action.html   200
+
# Fallback for all other routes
/*    /index.html   200
```

**Rationale:** This ensures `/auth/action.html` is served directly with a 200 status, preventing the catch-all from matching it.

### Step 2: Rebuild and Test

After making this change:

1. Build the application to verify the file exists
2. Test that `/auth/action.html` is served directly
3. Test that `/auth/action` redirects correctly

## Alternative Approach (If needed)

If the explicit rule doesn't work, we can try:

- Change all auth routes to use trailing slashes: `/auth/action/` instead of `/auth/action`
- Or remove the catch-all temporarily to test if that's the issue
- Or use a different status code for the catch-all

## Verification

After deployment:

1. `/auth/action` should 301 redirect to `/auth/action.html` 
2. `/auth/action.html` should load the page directly (200 status)
3. No redirect loops should occur

## Files Modified

- `app/public/_redirects` - Add explicit rule for `/auth/action.html`

### To-dos

- [x] Add explicit rule in _redirects to serve /auth/action.html directly (200) before catch-all
- [x] Rebuild application to verify changes
- [x] Deploy to dev.jobhackai.io and test
- [ ] Verify /auth/action and /auth/action.html both work without redirect loops