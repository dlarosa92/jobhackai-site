<!-- 13f24d82-1d63-4c04-b7db-4b01fa4ffbac ac87b207-998c-4224-ab49-26c4b4a7da5c -->
# Pre-Deployment Testing Plan: dev0 → develop

## Overview

This plan ensures thorough testing before merging `dev0` branch to `develop` branch to prevent the account navigation issues that caused previous rollbacks. The focus is on verifying authentication flows, routing, and environment configurations.

## Critical Areas to Test

### 1. Authentication & Navigation Flow

- **Account Button Navigation**: Verify clicking "Account" from navigation menu successfully routes to `account-setting.html` without redirecting to dashboard
- **Auth Guard Timing**: Test that `static-auth-guard.js` and Firebase auth initialization work correctly in QA environment
- **Email Verification**: Verify email verification redirects work correctly (should not redirect verified users)
- **Protected Pages**: Test all protected pages (dashboard, account-setting, billing-management) load correctly

### 2. Environment Configuration

- **Firebase Project ID**: Verify QA environment uses correct Firebase project (`jobhackai-qa`)
- **Stripe Keys**: Verify test Stripe keys are configured for QA
- **Environment Variables**: Confirm all required Cloudflare Pages environment variables are set for QA

### 3. Routing & Redirects

- **Navigation Links**: Verify all navigation links use correct paths (especially `account-setting.html`)
- **Redirect Rules**: Test `_redirects` file works correctly (dashboard.html → /dashboard)
- **Auth Routes**: Verify `/auth/action` routes work correctly

### 4. Cross-Environment Testing

- **Dev Environment**: Test all flows work correctly on dev.jobhackai.io
- **Build Verification**: Verify build completes without errors
- **Static Assets**: Ensure all JS, CSS, and HTML files are properly copied to output

## Pre-Deployment Checklist

### Phase 1: Code Review & Environment Verification

- [ ] Review recent commits on `dev0` branch for any auth/routing changes
- [ ] Verify `js/navigation.js` `updateLink` function correctly handles `account-setting.html` links
- [ ] Check `account-setting.html` auth guards are properly configured
- [ ] Verify `js/static-auth-guard.js` timeout and redirect logic
- [ ] Confirm `app/public/_redirects` rules are correct
- [ ] Check `app/public/_headers` for proper cache headers

### Phase 2: Local Testing

- [ ] Build application locally: `cd app && npm run build`
- [ ] Verify build output includes all files in `out/` directory
- [ ] Test account button navigation in local build
- [ ] Test authentication flow (login → dashboard → account settings)
- [ ] Test email verification flow
- [ ] Test logout and login redirects

### Phase 3: Dev Environment Testing (dev.jobhackai.io)

- [ ] Test account button navigation from dashboard
- [ ] Test account button navigation from other pages
- [ ] Verify user can access account-setting.html without redirect to dashboard
- [ ] Test all navigation menu items work correctly
- [ ] Test protected pages require authentication
- [ ] Test API endpoints respond correctly
- [ ] Verify Firebase auth initialization timing

### Phase 4: Environment Variables Verification

- [ ] Verify Cloudflare Pages QA project has correct environment variables:
- `FIREBASE_PROJECT_ID=jobhackai-qa`
- `STRIPE_SECRET_KEY` (test key)
- `STRIPE_WEBHOOK_SECRET` (test secret)
- All price IDs for test plans
- [ ] Compare dev and QA environment variables for differences
- [ ] Verify no hardcoded environment-specific values in code

### Phase 5: Pre-Merge Branch Comparison

- [ ] Compare `dev0` and `develop` branches for any differences
- [ ] Check for any uncommitted changes
- [ ] Verify branch is up to date with remote
- [ ] Review any merge conflicts that might occur

### Phase 6: Critical Path Testing

- [ ] **Account Navigation Test**: Click "Account" from navigation → must reach account-setting.html (not dashboard)
- [ ] **Auth Guard Test**: Access account-setting.html directly → must load if authenticated
- [ ] **Redirect Test**: Unauthenticated access to protected page → must redirect to login
- [ ] **Dashboard Test**: Login → must redirect to dashboard correctly
- [ ] **Navigation Test**: All navigation links work from account-setting page

## Post-Deployment Verification (After Merge)

### Immediate Checks (Within 5 minutes)

- [ ] Verify QA deployment completes successfully
- [ ] Test account button navigation on qa.jobhackai.io
- [ ] Verify authentication flows work
- [ ] Test critical user paths

### Extended Testing (Within 1 hour)

- [ ] Full regression testing of all features
- [ ] Test with different user roles/plans
- [ ] Monitor error logs in Cloudflare dashboard
- [ ] Verify API endpoints respond correctly

## Rollback Plan

If issues are detected:

1. Immediately stop user testing
2. Revert merge commit on `develop` branch
3. Push revert to trigger QA deployment rollback
4. Document issue for investigation
5. Re-test on dev0 before next attempt

## Key Files to Review

- `js/navigation.js` - Navigation configuration and link routing
- `account-setting.html` - Account page auth guards
- `js/static-auth-guard.js` - Static page authentication guard
- `app/public/_redirects` - Cloudflare Pages routing rules
- `app/package.json` - Build and deployment scripts
- Environment variables in Cloudflare Pages dashboard

## Notes

- Previous issue: Account button redirected to dashboard instead of account-setting.html
- Likely causes: Auth guard timing, Firebase initialization delays, or environment variable differences
- Focus testing on authentication flow and navigation routing