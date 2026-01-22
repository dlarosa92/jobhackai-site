# Replace Stripe Hardlinks with Safe Backend-Driven Upgrade Flow

## Summary

This PR replaces all direct Stripe Checkout URLs and hardcoded upgrade links with a centralized, backend-driven upgrade system that prevents duplicate subscriptions, handles trial-to-paid conversions seamlessly, and provides a consistent upgrade experience across the application.

**Key Improvements:**
- ✅ Prevents duplicate subscriptions (users can no longer accidentally create multiple active subscriptions)
- ✅ Handles trial → paid conversions immediately without creating new subscriptions
- ✅ Supports in-place upgrades (Essential → Pro → Premium) without checkout redirects
- ✅ Centralized upgrade logic with proper error handling and user feedback
- ✅ Added utility script for purging test accounts from D1 and KV storage

---

## Problem Statement

### Issues Addressed

1. **Duplicate Subscriptions**: Direct Checkout URLs and naive "always create a checkout session" behavior allowed users to create multiple active subscriptions (Essential + Pro + Premium simultaneously).

2. **Trial UX Problem**: Trial is implemented as Essential price with `trial_period_days=3`. When trialing users tried to "buy Essential now", Stripe saw they already had the Essential subscription (trialing) and plan selection appeared pre-selected, creating a confusing dead-end.

3. **Inconsistent Upgrade Flows**: Different pages used different methods to trigger upgrades (some hardcoded Stripe URLs, some calling `/api/stripe-checkout` directly), making it difficult to ensure consistent behavior and prevent edge cases.

4. **No In-Place Upgrade Support**: Users upgrading from Essential → Pro or Pro → Premium were forced through a full checkout flow instead of a seamless in-place upgrade.

---

## Solution Overview

### Backend: New `/api/upgrade-plan` Endpoint

A single, intelligent endpoint that:
- **For users with no subscription**: Creates a Stripe Checkout session (redirects to Stripe)
- **For users with active subscriptions**: Performs in-place upgrade (updates existing subscription, no redirect)
- **For trialing users**: Ends trial immediately and converts to paid plan (no new subscription created)
- **Prevents duplicates**: Checks for existing active/trialing subscriptions before any action
- **Handles edge cases**: Chooses "best" subscription if multiple exist, prevents downgrades, provides clear error codes

### Frontend: Centralized `upgradePlan()` Function

A unified upgrade function in `stripe-integration.js` that:
- Handles loading states and user feedback
- Calls `/api/upgrade-plan` with proper authentication
- Redirects to Stripe when needed, or updates UI in-place when upgrade succeeds
- Shows appropriate error messages and info banners
- Refreshes plan state and re-renders UI components automatically

### Hardening: Duplicate Guard in `stripe-checkout.js`

Added a safety check to prevent creating checkout sessions when a user already has an active/trialing subscription (protects against legacy CTAs or manual API calls).

---

## Changes Made

### 🆕 New Files

#### `app/functions/api/upgrade-plan.js` (452 lines)
**Purpose**: Centralized upgrade endpoint that intelligently handles all upgrade scenarios.

**Key Features:**
- **Auth Required**: Firebase ID token verification
- **Smart Subscription Detection**: 
  - Lists all subscriptions for customer
  - Filters active/trialing/past_due subscriptions
  - Picks "best" subscription if multiple exist (prefers active > trialing, higher tier > lower tier)
- **Three Upgrade Paths**:
  1. **No Subscription** → Creates Stripe Checkout session (returns redirect URL)
  2. **Active Subscription** → In-place upgrade via `subscriptions.update()` (returns success)
  3. **Trialing Subscription** → Ends trial immediately (`trial_end: 'now'`) and updates price if needed
- **Safety Features**:
  - Prevents downgrades (returns `DOWNGRADE_NOT_ALLOWED`)
  - Detects already-on-plan (returns `ALREADY_ON_PLAN`)
  - Uses idempotency keys for all Stripe operations
  - Invalidates billing caches after successful updates
- **Error Handling**: Structured error codes (`AUTH_REQUIRED`, `INVALID_PLAN`, `CUSTOMER_NOT_FOUND`, `UPDATE_FAILED`, etc.)
- **Logging**: Comprehensive `[BILLING-UPGRADE]` tagged logs for debugging

**API Contract:**
```typescript
POST /api/upgrade-plan
Headers: { Authorization: "Bearer <firebase-token>" }
Body: {
  targetPlan: "essential" | "pro" | "premium",
  returnUrl?: string,
  source?: string
}

Response (no subscription):
{ ok: true, action: "redirect", url: "<stripe-checkout-url>" }

Response (upgrade successful):
{ ok: true, action: "updated", plan: "<targetPlan>", subscriptionId: "...", customerId: "..." }

Response (error):
{ ok: false, code: "ALREADY_ON_PLAN" | "DOWNGRADE_NOT_ALLOWED" | "AUTH_REQUIRED" | ... }
```

#### `app/scripts/purge-test-accounts.sh` (290 lines)
**Purpose**: Utility script to clean up test accounts from D1 database and KV storage.

**Features:**
- Removes test accounts from D1 database (users, plans, billing_status tables)
- Deletes KV keys for test accounts (planByUid, billingStatus, trialUsedByUid, etc.)
- Supports both QA and DEV environments
- Color-coded output for easy reading
- Dry-run mode for safety
- Comprehensive error handling and rollback support

**Usage:**
```bash
./app/scripts/purge-test-accounts.sh [--dry-run] [--env=qa|dev]
```

---

### 🔄 Modified Files

#### `app/functions/api/stripe-checkout.js` (+50 lines)
**Changes:**
- Added duplicate subscription guard before creating checkout sessions
- Checks for existing active/trialing subscriptions
- Returns `ALREADY_SUBSCRIBED` error if user already has subscription (except for trial plan)
- Prevents accidental duplicate subscription creation from legacy CTAs or manual API calls

**Key Addition:**
```javascript
// Before creating checkout session, check for existing subscriptions
const subs = await listSubscriptions(env, customerId);
const activeSubs = subs.filter((sub) =>
  sub && ['active', 'trialing', 'past_due'].includes(sub.status)
);

if (activeSubs.length > 0 && plan !== 'trial') {
  return json({ 
    ok: false, 
    code: 'ALREADY_SUBSCRIBED', 
    plan: getPlanFromSubscription(activeSubs[0], env) 
  }, 409, origin, env);
}
```

#### `js/stripe-integration.js` (+120 lines)
**Changes:**
- Added new `upgradePlan(targetPlan, options)` function (lines 780-853)
- Exposed as `window.upgradePlan` for global access
- Added `showUpgradeInfoBanner()` helper for displaying info messages
- Handles all upgrade scenarios:
  - Shows loading state (disables button, shows overlay)
  - Calls `/api/upgrade-plan` with authentication
  - Handles redirect responses (navigates to Stripe Checkout)
  - Handles update responses (shows success toast, refreshes plan state, dispatches `planChanged` event)
  - Handles error responses (shows appropriate banners/messages)
- Maintains backward compatibility with existing `openCheckout()` and `manageSubscription()` functions

**Function Signature:**
```javascript
async function upgradePlan(targetPlan, options = {}) {
  // targetPlan: "essential" | "pro" | "premium"
  // options: { source?: string, returnUrl?: string, button?: HTMLElement }
}
```

#### `dashboard.html` (-98 lines, refactored)
**Changes:**
- Replaced direct `/api/stripe-checkout` calls with `upgradePlan()` function
- Simplified `handleUpgradeClick()` function (removed ~100 lines of duplicate logic)
- Now calls `window.upgradePlan(targetPlan, { source: 'dashboard' })`
- Automatically refreshes plan state after successful upgrades
- Plan pills, banners, and feature locks update without page reload

#### `resume-feedback-pro.html` (+31 lines)
**Changes:**
- Updated `upgradeToPro()` function to use `upgradePlan()` instead of direct API call
- Calls `window.upgradePlan('pro', { source: 'resume-feedback' })`
- Improved error handling and user feedback
- Maintains existing modal/overlay behavior

#### `interview-questions.html` (+8 lines)
**Changes:**
- Updated `startCheckoutLocal()` to use `upgradePlan()` function
- Calls `window.upgradePlan('pro', { source: 'interview-questions' })`
- Consistent upgrade experience with other pages

#### `account-setting.html` (+20 lines)
**Changes:**
- Added "Start Paid Now" button under trial countdown (when user is trialing)
- Button only visible when `plan === 'trial'` and `trialEndsAt` is in the future
- Calls `upgradePlan('essential', { source: 'account-settings' })`
- On success, refreshes plan state and hides countdown/button
- Provides fastest path to paid conversion for trialing users

---

## Technical Details

### Subscription Upgrade Logic

The upgrade endpoint uses the following decision tree:

```
User has subscription?
├─ No → Create Stripe Checkout session (redirect)
└─ Yes → Check subscription status
    ├─ Active → Check target plan
    │   ├─ Same plan → Return ALREADY_ON_PLAN
    │   ├─ Higher tier → In-place upgrade (update price)
    │   └─ Lower tier → Return DOWNGRADE_NOT_ALLOWED
    └─ Trialing → End trial immediately
        ├─ Same plan → Set trial_end='now'
        └─ Higher tier → Update price + set trial_end='now'
```

### Cache Invalidation

After successful subscription updates, the following KV keys are invalidated:
- `planByUid:${uid}`
- `billingStatus:${uid}`
- `trialUsedByUid:${uid}`
- `trialEndByUid:${uid}`

This ensures frontend fetches fresh data on next request.

### Idempotency

All Stripe operations use idempotency keys:
- Format: `${uid}:${hash(seed + day)}`
- Prevents duplicate charges/updates on retries
- Hash includes subscription ID and target plan for upgrade operations

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_REQUIRED` | 401 | Missing or invalid Firebase token |
| `INVALID_PLAN` | 400 | Target plan not in [essential, pro, premium] |
| `ALREADY_ON_PLAN` | 409 | User already has the requested plan |
| `DOWNGRADE_NOT_ALLOWED` | 409 | Attempting to downgrade (blocked) |
| `ALREADY_SUBSCRIBED` | 409 | User has active subscription (from stripe-checkout guard) |
| `CUSTOMER_NOT_FOUND` | 500 | Could not resolve/create Stripe customer |
| `SUBSCRIPTION_ITEM_MISSING` | 500 | Subscription exists but has no items |
| `UPDATE_FAILED` | 502 | Stripe API error during subscription update |
| `CHECKOUT_FAILED` | 502 | Stripe API error during checkout session creation |
| `SERVER_ERROR` | 500 | Unexpected exception |

---

## Testing Checklist

### Manual Testing Scenarios

- [ ] **Free user → Essential upgrade**
  - User with no subscription clicks upgrade
  - Should redirect to Stripe Checkout
  - After payment, subscription should be active

- [ ] **Trial user → Start Paid Now**
  - User in trial (day 2) clicks "Start Paid Now" on Account Settings
  - Trial should end immediately, subscription should become active
  - No Stripe Checkout redirect (in-place conversion)

- [ ] **Essential → Pro upgrade**
  - User with active Essential subscription upgrades to Pro
  - Should update in-place (no checkout redirect)
  - Plan state should refresh, UI should update immediately
  - Should see success toast/banner

- [ ] **Pro → Premium upgrade**
  - User with active Pro subscription upgrades to Premium
  - Should update in-place (no checkout redirect)
  - Plan state should refresh, UI should update immediately

- [ ] **Duplicate prevention**
  - User with active subscription tries to upgrade again
  - Should see info banner: "You already have an active subscription"
  - Should not create duplicate subscription

- [ ] **Already on plan**
  - User on Pro tries to upgrade to Pro again
  - Should return `ALREADY_ON_PLAN` error
  - Should show appropriate message

- [ ] **Downgrade attempt**
  - User on Premium tries to "upgrade" to Essential
  - Should return `DOWNGRADE_NOT_ALLOWED` error
  - Should show appropriate message

- [ ] **Plan state refresh**
  - After successful upgrade, plan pills/banners should update
  - Feature locks should unlock immediately
  - Trial countdown should disappear if converted to paid

- [ ] **Billing Management**
  - "Manage Subscription" button should still work
  - Should redirect to Stripe Billing Portal
  - Cancellations/invoices should work as before

---

## Files Changed

```
 account-setting.html                 |  20 +-
 app/functions/api/stripe-checkout.js  |  50 +++-
 app/functions/api/upgrade-plan.js    | 452 +++++++++++++++++++++++++++++++++++
 app/scripts/purge-test-accounts.sh   | 290 ++++++++++++++++++++++
 dashboard.html                        | 104 ++------
 interview-questions.html             |   8 +
 js/stripe-integration.js             | 120 +++++++++-
 resume-feedback-pro.html             |  31 ++-
 8 files changed, 977 insertions(+), 98 deletions(-)
```

---

## Breaking Changes

**None** - This is a backward-compatible enhancement. Existing `openCheckout()` and `manageSubscription()` functions remain unchanged. The new `upgradePlan()` function is additive.

---

## Migration Notes

- All upgrade CTAs now use `upgradePlan()` instead of direct `/api/stripe-checkout` calls
- No changes required to existing billing portal or cancellation flows
- Frontend automatically refreshes plan state after upgrades
- No database migrations required

---

## Related Issues

- Fixes duplicate subscription creation bug
- Resolves trial-to-paid conversion UX issues
- Enables seamless in-place upgrades

---

## Reviewers

Please focus on:
1. `/api/upgrade-plan` endpoint logic (subscription detection, upgrade paths)
2. Frontend integration (`upgradePlan()` function usage across pages)
3. Error handling and user feedback
4. Cache invalidation after updates
5. Test account purge script (if applicable)

---

## Deployment Notes

- No environment variable changes required
- Uses existing Stripe price IDs from env vars
- No database schema changes
- Safe to deploy to QA first for testing

---

**PR created from `stripe-changes` → `dev0`**
