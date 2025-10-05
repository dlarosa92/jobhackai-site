# Authentication & Pricing UX Flow - Test Plan

## Overview
This document outlines all user journeys for the improved authentication and pricing flow implementation.

**Date:** October 5, 2025  
**Branch:** dev0  
**Status:** Ready for Testing

---

## Test Scenarios

### 1. New User - Direct to Pricing Page

#### Journey 1A: New User Selects Free Account
**Steps:**
1. User visits site (not logged in)
2. Clicks "Pricing" in navbar
3. Clicks "Create Free Account" button

**Expected Behavior:**
- ✅ Redirects to `/login.html`
- ✅ Shows SIGNUP form (not login)
- ✅ Title: "Create your free account"
- ✅ NO plan banner shown (free account is default)
- ✅ After signup → Redirects to `/dashboard.html`

#### Journey 1B: New User Selects Trial Plan
**Steps:**
1. User visits site (not logged in)
2. Clicks "Pricing" in navbar
3. Clicks "Start Free Trial" button

**Expected Behavior:**
- ✅ Redirects to `/login.html`
- ✅ Shows SIGNUP form
- ✅ Title: "Sign up for 3-Day Free Trial"
- ✅ Green banner shows: "You're signing up for: $0 for 3 days"
- ✅ After signup → Redirects to `/add-card.html` (trial needs card)

#### Journey 1C: New User Selects Paid Plan (Essential/Pro/Premium)
**Steps:**
1. User visits site (not logged in)
2. Clicks "Pricing" in navbar
3. Clicks "Get Pro Plan" button

**Expected Behavior:**
- ✅ Button shows loading state: "⏳ Redirecting..."
- ✅ Redirects to `/login.html`
- ✅ Shows SIGNUP form
- ✅ Title: "Sign up for Pro Plan"
- ✅ Green banner shows: "You're signing up for: Pro Plan ($59/mo)"
- ✅ After signup → Redirects to `/checkout.html`

---

### 2. Existing User - Wants to Login

#### Journey 2A: User Clicks "Login" from Navbar
**Steps:**
1. User visits site (not logged in)
2. Clicks "Login" in navbar

**Expected Behavior:**
- ✅ Redirects to `/login.html`
- ✅ Shows LOGIN form (not signup)
- ✅ Title: "Welcome back"
- ✅ NO plan banner shown
- ✅ Link at bottom: "Don't have an account? Sign up"
- ✅ After login → Redirects to `/dashboard.html`

#### Journey 2B: User on Login Page Toggles to Signup
**Steps:**
1. User on login page (login form showing)
2. Clicks "Don't have an account? Sign up"

**Expected Behavior:**
- ✅ Form switches to SIGNUP
- ✅ Title: "Create your account"
- ✅ NO plan banner shown (no plan selected)
- ✅ Link at bottom: "Already have an account? Back to Login"

#### Journey 2C: User on Signup Page Toggles to Login
**Steps:**
1. User on login page (signup form showing with a plan)
2. Clicks "Already have an account? Back to Login"

**Expected Behavior:**
- ✅ Form switches to LOGIN
- ✅ Title: "Welcome back"
- ✅ Plan banner DISAPPEARS
- ✅ `selected-plan` removed from localStorage
- ✅ Link at bottom: "Don't have an account? Sign up"

---

### 3. Existing User - Wants to Upgrade

#### Journey 3A: Logged-in User on Free Plan → Upgrades to Pro
**Steps:**
1. User is logged in (free plan)
2. Visits pricing page
3. Clicks "Get Pro Plan"

**Expected Behavior:**
- ✅ Button changes to "Upgrade to Pro Plan"
- ✅ NO redirect to login page
- ✅ Beautiful modal appears:
  - Title: "Upgrade Your Plan"
  - Shows current plan: "Free"
  - Shows new plan: "Pro Plan - $59/month"
  - Warning: "Your new plan will start immediately..."
- ✅ User clicks "Confirm Upgrade"
- ✅ Success modal appears with checkmark animation
- ✅ "Upgrade Successful! You're now on the Pro Plan"
- ✅ Redirects to `/billing-management.html` after 2 seconds

#### Journey 3B: Logged-in User Tries to Downgrade (Error Case)
**Steps:**
1. User is logged in (Pro plan)
2. Visits pricing page
3. Clicks "Get Essential Plan" (lower tier)

**Expected Behavior:**
- ✅ Error modal appears:
  - Icon: Warning symbol (red)
  - Title: "Already on This Plan"
  - Message: "You're currently on the pro plan. Please select a higher tier..."
- ✅ User clicks "Got it"
- ✅ Modal closes, no changes made

#### Journey 3C: Logged-in User Without Card → Upgrade Blocked
**Steps:**
1. User is logged in (free plan, no card on file)
2. Visits pricing page
3. Clicks "Get Essential Plan"

**Expected Behavior:**
- ✅ Modal appears: "Add a Payment Method"
- ✅ Message: "You must add a payment method to upgrade"
- ✅ Button: "Go to Billing"
- ✅ Clicking "Go to Billing" → Redirects to `/billing-management.html`

---

### 4. Edge Cases & Referrer Handling

#### Journey 4A: User Directly Visits `/login.html` (No Referrer)
**Steps:**
1. User types `jobhackai.com/login.html` in browser
2. No referrer, no plan in localStorage

**Expected Behavior:**
- ✅ Shows LOGIN form (default)
- ✅ Title: "Welcome back"
- ✅ NO plan banner
- ✅ Any stale `selected-plan` in localStorage is cleared

#### Journey 4B: User Comes from Pricing, Then Refreshes Login Page
**Steps:**
1. User clicks plan from pricing → Goes to login with plan banner
2. User refreshes the page

**Expected Behavior:**
- ✅ Referrer is lost on refresh
- ✅ Plan banner DISAPPEARS (no longer coming from pricing)
- ✅ Form switches to LOGIN (default)
- ✅ `selected-plan` cleared from localStorage

#### Journey 4C: User Clicks "Back" After Login
**Steps:**
1. User on pricing page, clicks plan
2. Redirected to login page
3. User clicks browser "Back" button

**Expected Behavior:**
- ✅ Returns to pricing page
- ✅ Plan selection NOT stored (user didn't complete signup)

---

### 5. Social Login (Google/LinkedIn)

#### Journey 5A: New User Signs Up with Google + Plan
**Steps:**
1. User on signup form with "Pro Plan" banner
2. Clicks "Continue with Google"

**Expected Behavior:**
- ✅ Button shows "Signing in..."
- ✅ Google OAuth popup appears
- ✅ After successful auth:
  - Account created with Pro plan
  - Redirects to `/checkout.html` (paid plan)

#### Journey 5B: Existing User Logs In with Google
**Steps:**
1. User on login form (no plan)
2. Clicks "Continue with Google"

**Expected Behavior:**
- ✅ Button shows "Signing in..."
- ✅ After successful auth:
  - User logged in
  - Redirects to `/dashboard.html`

---

## Verification Checklist

### Visual Design
- [ ] Login page title changes contextually
- [ ] Plan banner shows correct plan and price
- [ ] Banner only shows when appropriate
- [ ] Buttons have loading states (⏳ emoji + text)
- [ ] Modals have smooth animations
- [ ] Success modal has checkmark animation

### Functionality
- [ ] localStorage properly managed (`selected-plan`, `plan-amount`)
- [ ] Referrer detection works correctly
- [ ] Plan clearing works when switching forms
- [ ] Authenticated users don't get redirected to login
- [ ] Upgrade path shows proper confirmation
- [ ] Error cases show appropriate modals

### Navigation
- [ ] "Login" link in navbar goes to login form
- [ ] "Start Free Trial" button goes to pricing first
- [ ] Form toggle links work correctly
- [ ] Post-auth routing depends on plan type

### Data Persistence
- [ ] Plan selection survives page load when coming from pricing
- [ ] Plan selection cleared when appropriate
- [ ] User plan updated in localStorage after upgrade
- [ ] Navigation system updates after plan change

---

## Test Data

### Test Accounts (Quick Plan Switcher)
```javascript
// Free User
email: demo@jobhackai.com
plan: free

// Trial User
email: trial@jobhackai.com
plan: trial

// Pro User
email: pro@jobhackai.com
plan: pro
```

### Test Plans
```javascript
free: $0/month (no card required)
trial: $0 for 3 days (card required)
essential: $29/month
pro: $59/month
premium: $99/month
```

---

## Known Issues / Future Improvements

None at this time - all functionality implemented as designed.

---

## Sign-Off

**Tested By:** _________________  
**Date:** _________________  
**Status:** ☐ PASS | ☐ FAIL | ☐ NEEDS REVIEW  
**Notes:**


