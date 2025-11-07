# 🚀 QA Migration Checklist - DEV0 → DEVELOP

**PR**: #73  
**Date**: $(date +%Y-%m-%d)  
**Status**: ⏳ Pending Merge

## 📋 Pre-Merge Verification

### Code Review
- [ ] PR reviewed and approved
- [ ] No merge conflicts
- [ ] All CI checks passing (if applicable)
- [ ] Code follows project standards

### Environment Variables (Cloudflare Pages - QA)
Verify these are set in Cloudflare Dashboard → Pages → Settings → Environment Variables:

- [ ] `FIREBASE_PROJECT_ID` = `jobhackai-qa` (or appropriate QA project ID)
- [ ] `STRIPE_SECRET_KEY` = `sk_test_...` (QA/test Stripe key)
- [ ] `STRIPE_WEBHOOK_SECRET` = `whsec_test_...` (QA webhook secret)
- [ ] `PRICE_ESSENTIAL_MONTHLY` = `price_...` (QA price ID)
- [ ] `PRICE_PRO_MONTHLY` = `price_...` (QA price ID)
- [ ] `PRICE_PREMIUM_MONTHLY` = `price_...` (QA price ID)
- [ ] `FRONTEND_URL` = `https://qa.jobhackai.io` (or appropriate QA URL)

### Stripe Webhook Configuration
- [ ] Webhook endpoint configured in Stripe Dashboard
- [ ] Webhook URL: `https://qa.jobhackai.io/api/stripe-webhook`
- [ ] Events configured:
  - [ ] `checkout.session.completed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`

## 🔄 Post-Merge Deployment

### Step 1: Merge PR
```bash
# After PR is approved, merge via GitHub UI or:
gh pr merge 73 --squash  # or --merge, --rebase
```

### Step 2: Build & Deploy
```bash
cd app
npm install
npm run build
npm run deploy:qa
```

### Step 3: Verify Deployment
```bash
# Check deployment status
gh run list --workflow=deploy  # if using GitHub Actions
# OR check Cloudflare Pages dashboard
```

## ✅ Post-Deployment Verification

### API Endpoint Health Checks

#### 1. Authentication Endpoint
```bash
curl -X GET https://qa.jobhackai.io/api/plan/me
# Expected: 401 Unauthorized (not 404!)
```

#### 2. Plan Endpoint (with JWT)
```bash
# Get token from browser console:
# firebase.auth().currentUser.getIdToken().then(console.log)

export TOKEN="your_jwt_token_here"
curl -X GET https://qa.jobhackai.io/api/plan/me \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"plan":"free"} or actual plan
```

#### 3. Billing Status Endpoint
```bash
curl -X GET https://qa.jobhackai.io/api/billing-status \
  -H "Authorization: Bearer $TOKEN"
# Expected: Comprehensive billing status JSON
```

#### 4. Stripe Checkout Endpoint
```bash
curl -X POST https://qa.jobhackai.io/api/stripe-checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro"}'
# Expected: {"ok":true,"url":"https://checkout.stripe.com/...","sessionId":"cs_..."}
```

#### 5. Billing Portal Endpoint
```bash
curl -X POST https://qa.jobhackai.io/api/billing-portal \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"ok":true,"url":"https://billing.stripe.com/..."} or 404 if no customer
```

#### 6. Cache Headers Verification
```bash
curl -I https://qa.jobhackai.io/api/plan/me
# Expected: Cache-Control: no-store
```

### UI/UX Verification

- [ ] Dashboard loads: `https://qa.jobhackai.io/dashboard`
- [ ] Dashboard redirect works: `https://qa.jobhackai.io/dashboard.html` → `/dashboard`
- [ ] Pricing page loads without redirect loops: `https://qa.jobhackai.io/pricing-a`
- [ ] Navigation hover states work correctly
- [ ] Favicon displays correctly (check both light and dark mode)
- [ ] Account settings page functions correctly
- [ ] No console errors in browser DevTools

### Integration Flow Tests

#### Test 1: User Registration & Email Verification
- [ ] New user can register
- [ ] Email verification link works
- [ ] Redirect after verification works correctly

#### Test 2: Plan Upgrade Flow
- [ ] User can click "Upgrade" button from dashboard
- [ ] Checkout page opens (Stripe hosted)
- [ ] Can complete payment with test card (4242 4242 4242 4242)
- [ ] Redirects back to `/dashboard?paid=1`
- [ ] Plan updates immediately in UI

#### Test 3: Billing Portal Access
- [ ] User can access billing portal from account settings
- [ ] Billing portal loads correctly
- [ ] Can update payment method
- [ ] Can cancel subscription (if applicable)

#### Test 4: Plan Synchronization
- [ ] Plan changes reflect immediately after checkout
- [ ] Plan persists after page refresh
- [ ] Plan sync works after logout/login

### Error Handling Verification

- [ ] Invalid JWT returns 401 (not 500)
- [ ] Missing auth header returns 401
- [ ] Invalid Stripe requests return appropriate errors
- [ ] KV failures don't block checkout flow
- [ ] Timeout errors return 504 status

## 🐛 Troubleshooting

### Issue: API returns 404
**Solution**: 
- Verify functions are in `app/functions/api/`
- Check Cloudflare Pages deployment logs
- Ensure build completed successfully

### Issue: JWT verification fails
**Solution**:
- Verify `FIREBASE_PROJECT_ID` is set correctly
- Check Firebase project ID matches QA environment
- Ensure token hasn't expired (get fresh token)

### Issue: Stripe checkout fails
**Solution**:
- Verify `STRIPE_SECRET_KEY` is set
- Check `PRICE_*_MONTHLY` variables match Stripe Dashboard
- Verify webhook secret is correct
- Check Stripe API logs

### Issue: CORS errors
**Solution**:
- Verify origin is in allowed origins list
- Check `_headers` file is deployed
- Verify `FRONTEND_URL` matches QA domain

### Issue: KV operations fail
**Solution**:
- Verify `JOBHACKAI_KV` namespace is bound
- Check KV namespace exists in Cloudflare Dashboard
- Note: Checkout should still work with fallback logic

## 📊 Success Criteria

All of the following must pass:

- ✅ All API endpoints respond (not 404)
- ✅ JWT authentication works
- ✅ Stripe checkout creates sessions
- ✅ Billing portal generates URLs
- ✅ Dashboard redirects work (301)
- ✅ API responses have `Cache-Control: no-store`
- ✅ CORS works for QA environment
- ✅ No console errors in browser
- ✅ Plan upgrade flow completes successfully
- ✅ Webhook receives events from Stripe

## 📝 Post-Migration Notes

After successful migration, document:

- [ ] Deployment timestamp
- [ ] Any issues encountered
- [ ] Performance metrics (if applicable)
- [ ] User feedback (if any)

## 🔗 Related Resources

- [PR #73](https://github.com/dlarosa92/jobhackai-site/pull/73)
- [Deployment Guide](./app/DEPLOYMENT.md)
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md)
- [502 Error Fix Summary](./FIX_502_ERROR_SUMMARY.md)

---

**Migration Status**: ⏳ Pending  
**Last Updated**: $(date +%Y-%m-%d\ %H:%M:%S)

