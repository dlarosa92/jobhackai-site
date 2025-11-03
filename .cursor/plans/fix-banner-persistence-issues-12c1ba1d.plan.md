<!-- 12c1ba1d-782a-4e18-a7c0-77893fa15660 e4392efc-7530-40d2-bdac-8dd5dcd9ec77 -->
# Fix Banner Persistence Issues

## Problem Summary

The plan selection banner persists incorrectly after logout, Stripe cancellation, and navigation away from the login page. The banner should only appear when a user actively selects a plan from pricing and is on the signup form.

## Root Cause

- `sessionStorage.selectedPlan` is not cleared on logout
- URL param `?plan=...` persists and causes banner to reappear on back navigation
- Stripe cancel returns to pricing instead of login with cancel flag
- Banner shows on login form when it should only appear on signup form
- Navigation links don't clear selectedPlan before navigating away
- **Logged-out existing users see banner on login form** (should never see banner when logging in)

## Solution Overview

1. Clear `selectedPlan` in logout handler (`js/navigation.js`)
2. Detect Stripe cancel return (`?cancel=1`) and auto-hide banner (`js/login-page.js`)
3. Remove `?plan` from URL after initial detection to prevent back-button persistence
4. Gate banner rendering: only show on signup form when unauthenticated
5. Clear `selectedPlan` when navigating away via nav links
6. Update Stripe cancel URL to return to login with cancel flag (`app/functions/api/stripe-checkout.js`)

## Implementation Details

### Files to Modify

**1. `js/navigation.js`**

- Add `sessionStorage.removeItem('selectedPlan')` in `logout()` function before redirect
- Clear URL params in logout redirect if needed

**2. `js/login-page.js`**

- Detect `?cancel=1` URL param and auto-clear `selectedPlan` + hide banner on page load
- Remove `?plan` from URL immediately after detecting it (use `history.replaceState`)
- Gate banner visibility: only show when signup form is active AND user is unauthenticated
- Add event listeners to navigation links (Home, Blog, Features) to clear `selectedPlan` before navigation
- Ensure form toggle handlers clear `selectedPlan` when switching to login form (already exists but verify)

**3. `app/functions/api/stripe-checkout.js`**

- Change `cancel_url` from `pricing-a.html` to `login.html?cancel=1`
- Use `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/login.html?cancel=1`

**4. `pricing-a.html`**

- Verify authenticated users don't write `selectedPlan` when upgrading (should be direct to Stripe)
- Ensure logged-in upgrade flow bypasses login page entirely

## UX Validation Checklist

- [ ] Banner disappears when switching from signup to login form
- [ ] Banner disappears after logout
- [ ] Banner disappears when navigating to Home/Blog/Features
- [ ] Banner disappears when returning from Stripe cancel
- [ ] Banner only shows on signup form, never on login form
- [ ] URL param `?plan` is removed after first render (prevents back-button issues)
- [ ] Logged-in users clicking paid plans go directly to Stripe checkout (no banner)
- [ ] Free plan selection clears banner and goes to dashboard after auth

### To-dos

- [ ] Update Stripe checkout cancel_url to return to login.html?cancel=1 instead of pricing-a.html
- [ ] Add sessionStorage.removeItem("selectedPlan") to logout() function in js/navigation.js
- [ ] Detect ?cancel=1 URL param in js/login-page.js and auto-clear selectedPlan + hide banner on page load
- [ ] Remove ?plan from URL after initial detection using history.replaceState to prevent back-button persistence
- [ ] Gate banner rendering: only show when signup form is active AND user is unauthenticated
- [ ] Add event listeners to nav links (Home/Blog/Features) to clear selectedPlan before navigating away from login page
- [ ] Verify form toggle handlers properly clear selectedPlan when switching to login form (should already exist)