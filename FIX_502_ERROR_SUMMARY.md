# Fix: Upgrade Button Checkout 502 Error

## Problem Summary

Users clicking upgrade buttons on the dashboard were experiencing:
1. **502 Bad Gateway** errors when calling `/api/stripe-checkout`
2. **Redirect loops** when navigating to `/pricing-a?plan=essential`
3. Generic error messages that didn't help diagnose the root cause

## Root Causes Identified

### 1. Missing Error Handling for KV Operations
- KV read/write operations could fail silently, causing the function to hang or fail
- No fallback when KV is unavailable

### 2. Poor Stripe API Error Handling
- Errors from Stripe API weren't being parsed correctly
- Response status codes weren't being checked before parsing JSON
- No distinction between timeout errors and other errors

### 3. Import Path Inconsistency
- `billing-portal.js` was missing `.js` extension in import path
- Cloudflare Workers may require explicit file extensions

### 4. URL Format Issues
- Success/cancel URLs used `.html` extensions instead of clean routes
- Could cause redirect issues

## Changes Made

### 1. Enhanced Error Handling (`app/functions/api/stripe-checkout.js`)

#### KV Operations Made Non-Blocking
```javascript
// Before: Could fail silently
let customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));

// After: Graceful fallback
let customerId = null;
try {
  customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
} catch (kvError) {
  console.log('🟡 [CHECKOUT] KV read error (non-fatal)', kvError?.message || kvError);
  // Continue without cached customer ID - will create new one
}
```

#### Improved Stripe API Error Parsing
```javascript
// Before: Assumed JSON response
const c = await res.json();
if (!res.ok) {
  return json({ ok: false, error: c?.error?.message || 'stripe_customer_error' }, 502, origin, env);
}

// After: Parse error text safely
if (!res.ok) {
  const errorText = await res.text();
  let errorData;
  try {
    errorData = JSON.parse(errorText);
  } catch {
    errorData = { error: { message: errorText || 'Unknown Stripe error' } };
  }
  console.log('🔴 [CHECKOUT] Customer create failed', {
    status: res.status,
    statusText: res.statusText,
    error: errorData
  });
  return json({ ok: false, error: errorData?.error?.message || 'stripe_customer_error' }, 502, origin, env);
}
```

#### Timeout Error Detection
```javascript
// Added timeout error handling
if (sessionError?.name === 'AbortError' || sessionError?.message?.includes('timeout')) {
  return json({ ok: false, error: 'Request timeout. Please try again.' }, 504, origin, env);
}
```

#### Better Logging
- Added detailed error logging with stack traces
- Log response status codes and status text
- Log customer ID and price ID for debugging

### 2. Fixed Import Path (`app/functions/api/billing-portal.js`)
```javascript
// Before
import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth';

// After
import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
```

### 3. Updated URLs to Use Clean Routes
```javascript
// Before
success_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard.html?paid=1`
cancel_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing-a.html`

// After
success_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard?paid=1`
cancel_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing-a`
```

## Testing Recommendations

1. **Test KV Failure Scenarios**
   - Temporarily disable KV namespace
   - Verify checkout still works (creates new customer)

2. **Test Stripe API Errors**
   - Use invalid Stripe key
   - Verify error messages are user-friendly

3. **Test Timeout Scenarios**
   - Simulate slow Stripe API responses
   - Verify timeout errors return 504 status

4. **Test Redirect Flow**
   - Click upgrade button from dashboard
   - Verify redirect to pricing page preserves query params
   - Verify checkout success redirects correctly

## Deployment Notes

1. **No Breaking Changes**: All changes are backward compatible
2. **No Environment Variable Changes**: No new env vars required
3. **Deploy from `/app` directory**: `npm run build && npm run deploy:qa`

## Expected Outcomes

- ✅ 502 errors should be resolved or provide better error messages
- ✅ KV failures won't block checkout flow
- ✅ Better error logging for debugging
- ✅ Cleaner URLs in Stripe redirects
- ✅ Timeout errors properly handled

## Additional Debugging

If 502 errors persist after deployment:

1. **Check Cloudflare Workers Logs**
   - Look for detailed error messages we added
   - Check for KV errors
   - Check for Stripe API errors

2. **Verify Environment Variables**
   - `FIREBASE_PROJECT_ID` is set
   - `STRIPE_SECRET_KEY` is set
   - `STRIPE_PRICE_*_MONTHLY` are set

3. **Check KV Namespace**
   - Verify `JOBHACKAI_KV` is bound to the Worker
   - Check KV namespace is accessible

4. **Test Stripe API Directly**
   - Verify Stripe API key is valid
   - Test creating a customer manually

## Files Changed

- `app/functions/api/stripe-checkout.js` - Enhanced error handling
- `app/functions/api/billing-portal.js` - Fixed import path
- `app/public/_redirects` - No changes needed (query params preserved automatically)

