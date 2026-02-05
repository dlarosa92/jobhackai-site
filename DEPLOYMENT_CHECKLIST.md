# 🚀 Deployment Checklist

Use this checklist to ensure successful deployment of your JWT-secured APIs.

## Pre-Deployment (One-Time Setup)

### ☐ 1. Get Stripe Configuration
- [ ] Log in to [Stripe Dashboard](https://dashboard.stripe.com/)
- [ ] Navigate to **Developers** → **API Keys**
- [ ] Copy **Secret Key** (starts with `sk_test_` or `sk_live_`)
- [ ] Navigate to **Developers** → **Webhooks**
- [ ] Copy **Signing Secret** (starts with `whsec_`)
- [ ] Navigate to **Products** → **Prices**
- [ ] Copy price IDs for each plan (start with `price_`)

### ☐ 2. Get Firebase Configuration
- [ ] Log in to [Firebase Console](https://console.firebase.google.com/)
- [ ] Select your project
- [ ] Go to **Project Settings** (gear icon)
- [ ] Copy **Project ID** (e.g., `jobhackai-dev`)

### ☐ 3. Set Environment Variables in Cloudflare
- [ ] Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
- [ ] Navigate to **Pages** → Select your project
- [ ] Go to **Settings** → **Environment Variables**
- [ ] Click **Add Variable** for each:

**For Preview/QA Environment:**
```
FIREBASE_PROJECT_ID = jobhackai-qa
STRIPE_SECRET_KEY = sk_test_...
STRIPE_WEBHOOK_SECRET = whsec_test_...
PRICE_ESSENTIAL_MONTHLY = price_...
PRICE_PRO_MONTHLY = price_...
PRICE_PREMIUM_MONTHLY = price_...
```

**For Production Environment:**
```
FIREBASE_PROJECT_ID = jobhackai-prod
STRIPE_SECRET_KEY = sk_live_...
STRIPE_WEBHOOK_SECRET = whsec_live_...
PRICE_ESSENTIAL_MONTHLY = price_...
PRICE_PRO_MONTHLY = price_...
PRICE_PREMIUM_MONTHLY = price_...
```

- [ ] Click **Save** after adding all variables

## Deployment Steps

### ☐ 4. Install Dependencies
```bash
cd app
npm install
```

**Verify:**
- [ ] `node_modules/` directory created
- [ ] `jose` package installed (check `node_modules/jose`)
- [ ] No errors in terminal

### ☐ 5. Build the Application
```bash
npm run build
```

**Verify:**
- [ ] Build completes successfully
- [ ] `out/` directory created
- [ ] `out/_redirects` file exists
- [ ] `out/_headers` file exists
- [ ] No TypeScript errors
- [ ] No build warnings (or only minor ones)

### ☐ 6. Deploy to Cloudflare Pages

**For QA Environment:**
```bash
npm run deploy:qa
```

**For Production:**
```bash
npm run deploy:prod
```

**Verify:**
- [ ] Deployment succeeds
- [ ] No error messages in terminal
- [ ] Cloudflare shows deployment as "Active"
- [ ] Deployment URL displayed

## Post-Deployment Verification

### ☐ 7. Run Automated Tests
```bash
cd app
./scripts/verify-deployment.sh dev     # For dev/QA
./scripts/verify-deployment.sh prod    # For production
```

**Verify all tests pass:**
- [ ] ✅ API endpoint availability (HTTP 405 or 401)
- [ ] ✅ Dashboard redirect (HTTP 200 or 301)
- [ ] ✅ Cache headers on API routes
- [ ] ✅ CORS headers present
- [ ] ✅ Stripe checkout endpoint exists
- [ ] ✅ Billing portal endpoint exists
- [ ] ✅ Auth endpoint works
- [ ] ✅ Stripe webhook endpoint requires signature

### ☐ 8. Manual API Tests

**Test 1: API Endpoint Exists**
```bash
curl -X GET https://dev.jobhackai.io/api/plan/me
```
- [ ] Returns HTTP 401 (not 404!)
- [ ] Response: `{"error":"unauthorized"}`

**Test 2: Get Firebase JWT Token**
Open browser console on your site:
```javascript
firebase.auth().currentUser.getIdToken().then(token => {
  console.log(token);
  // Copy this token for next step
});
```
- [ ] Token copied to clipboard

**Test 3: Test JWT Authentication**
```bash
export TOKEN="YOUR_TOKEN_HERE"
curl -X GET https://dev.jobhackai.io/api/plan/me \
  -H "Authorization: Bearer $TOKEN"
```
- [ ] Returns HTTP 200
- [ ] Response: `{"plan":"free"}` (or your actual plan)

**Test 4: Test Stripe Checkout**
```bash
curl -X POST https://dev.jobhackai.io/api/stripe-checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro"}'
```
- [ ] Returns HTTP 200
- [ ] Response includes `"ok":true`
- [ ] Response includes Stripe checkout URL
- [ ] Response includes session ID

**Test 5: Test Billing Portal**
```bash
curl -X POST https://dev.jobhackai.io/api/billing-portal \
  -H "Authorization: Bearer $TOKEN"
```
- [ ] Returns HTTP 200 (if user has customer) or 404 (if no customer yet)
- [ ] If 200, response includes billing portal URL

### ☐ 9. Browser Tests

**Test 1: Dashboard Access**
- [ ] Navigate to `https://dev.jobhackai.io/dashboard`
- [ ] Page loads successfully
- [ ] No 404 error

**Test 2: Dashboard Redirect**
- [ ] Navigate to `https://dev.jobhackai.io/dashboard.html`
- [ ] Automatically redirects to `/dashboard`
- [ ] URL changes in browser

**Test 3: Stripe Checkout Flow**
- [ ] Click "Upgrade" button on dashboard
- [ ] Checkout page opens (Stripe hosted)
- [ ] Can complete payment
- [ ] Redirects back to `/dashboard?paid=1` (not `/dashboard.html`)

**Test 4: Browser Console (No CORS Errors)**
- [ ] Open browser console (F12)
- [ ] Navigate to dashboard
- [ ] No red CORS errors
- [ ] API calls succeed

### ☐ 10. Stripe Webhook Configuration

**Configure Webhook in Stripe:**
- [ ] Go to [Stripe Dashboard](https://dashboard.stripe.com/) → **Developers** → **Webhooks**
- [ ] Click **Add Endpoint**
- [ ] Enter URL: `https://dev.jobhackai.io/api/stripe-webhook`
- [ ] Select events:
  - [ ] `checkout.session.completed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
- [ ] Click **Add Endpoint**
- [ ] Test webhook by clicking **Send test webhook**
- [ ] Verify webhook returns 200 OK

## Troubleshooting

### If API returns 404:
- [ ] Check `app/functions/` contains all API files
- [ ] Verify deployment completed successfully
- [ ] Check Cloudflare Pages build logs
- [ ] Ensure `out/` directory has functions

### If JWT fails:
- [ ] Verify `FIREBASE_PROJECT_ID` is set in Cloudflare
- [ ] Check Firebase project ID is correct
- [ ] Ensure token hasn't expired (get fresh token)
- [ ] Verify user is logged in to Firebase

### If Stripe fails:
- [ ] Verify `STRIPE_SECRET_KEY` is set
- [ ] Check `PRICE_*_MONTHLY` variables match Stripe
- [ ] Ensure webhook secret is correct
- [ ] Test Stripe keys with Stripe CLI

### If CORS errors:
- [ ] Check origin is in `allowedOrigins` array
- [ ] Verify `_headers` file deployed
- [ ] Check browser console for specific error
- [ ] Ensure request includes proper headers

## Final Verification

### ☐ 11. End-to-End Test
- [ ] Create new test user account
- [ ] Log in with test user
- [ ] View dashboard (see plan: free)
- [ ] Click "Upgrade" button
- [ ] Complete Stripe checkout (use test card: 4242 4242 4242 4242)
- [ ] Redirected back to dashboard
- [ ] Plan updated (not "free" anymore)
- [ ] Can access billing portal
- [ ] Webhook received in Stripe dashboard

## Success Criteria

All checkboxes above should be ✅. If any fail, refer to troubleshooting section or review:
- `app/DEPLOYMENT.md` - Detailed deployment guide
- `IMPLEMENTATION_SUMMARY.md` - What was changed and why
- `QUICK_REFERENCE.md` - Quick commands reference

## 🎉 Deployment Complete!

Once all checks pass, your JWT-secured APIs are live and working correctly.

**No manual steps required for future deployments** - just:
```bash
cd app
npm run build
npm run deploy:qa    # or deploy:prod
```

---

**Estimated Time**: 15-30 minutes (first time)  
**Subsequent Deployments**: 2-3 minutes  
**Last Updated**: October 8, 2025



