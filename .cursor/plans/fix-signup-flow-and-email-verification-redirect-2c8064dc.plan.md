<!-- 2c8064dc-2e01-4a7d-8470-f6643c1a81bd f7b9309c-fea6-41b4-a272-d9b71e8660eb -->
# Fix Signup Flow and Email Verification Redirect

## Problem Analysis

From the browser recordings, two issues are identified:

1. **Missing Stripe Redirect After Email Verification**: When a new user signs up with a trial/paid plan selection, they complete signup → verify email → click verification link → but are redirected to dashboard as a free user instead of Stripe checkout.

2. **Email Verification Opens in New Tab**: The verification link opens in a new browser tab, leaving the previous tab open. This creates a poor UX.

## Root Cause

- `auth-action.js` (line 158) redirects to `/dashboard.html` after successful email verification without checking for `selectedPlan` in sessionStorage
- The email verification link behavior (new tab) is browser default, but we can handle tab replacement after verification

## Solution

### 1. Update auth-action.js to check for plan selection after verification

**File:** `js/auth-action.js`

After successful email verification (around line 148-158), check for `selectedPlan` in sessionStorage and redirect to Stripe checkout if a paid plan was selected, similar to how `verify-email.js` does it.

**Changes:**

- Import authManager to get user token
- After successful verification, check sessionStorage for `selectedPlan`
- If plan requires payment (trial, essential, pro, premium), call `/api/stripe-checkout` and redirect to Stripe
- Otherwise, redirect to dashboard
- Handle tab replacement: if window.opener exists, close the opener window after redirect

### 2. Preserve selectedPlan across email verification

The `selectedPlan` is stored in sessionStorage, which persists across tabs in the same session. However, we need to ensure it's available when the auth-action page loads.

**File:** `js/auth-action.js`

- Read `selectedPlan` from sessionStorage before redirect
- If plan requires payment, preserve it until Stripe checkout completes
- Only clear `selectedPlan` after successful payment or if user explicitly cancels

### 3. Handle tab replacement for email verification

**File:** `js/auth-action.js`

- After successful verification and redirect decision, check if `window.opener` exists
- If it exists, close the opener window after a short delay to allow redirect to complete
- Use `window.location.replace()` instead of `window.location.href` to avoid adding to browser history

## Implementation Details

### auth-action.js Changes

1. Add plan checking logic after email verification (similar to verify-email.js routeAfterVerification)
2. Import or access authManager to get ID token for Stripe checkout API call
3. Add tab replacement logic to close opener window if it exists
4. Preserve selectedPlan until Stripe checkout completes

## Files to Modify

- `js/auth-action.js` - Add plan checking and Stripe redirect logic after email verification
- Test: Verify that new users with trial/paid plans are redirected to Stripe after email verification
- Test: Verify that email verification replaces the tab instead of opening a new one

## Deployment Steps

1. Create new branch from dev0
2. Make code changes to auth-action.js
3. Test the changes locally if possible
4. Commit changes
5. Push branch and create pull request to dev0

### To-dos

- [ ] Update auth-action.js handleEmailVerification() to check sessionStorage for selectedPlan and redirect to Stripe checkout if plan requires payment
- [ ] Ensure selectedPlan from sessionStorage is preserved and used for redirect after email verification
- [ ] Add logic to close opener window if it exists after email verification redirect
- [ ] Test complete flow: pricing page → signup → email verification → Stripe checkout