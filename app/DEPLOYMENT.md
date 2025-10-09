# JobHackAI Cloudflare Pages Deployment Guide

## 🎯 Overview

This guide covers deploying the JWT-secured API functions to Cloudflare Pages. All manual steps have been eliminated through automation.

## ✅ What Was Fixed

### 1. **Root Cause: Function Location**
- **Problem**: Functions were in `/functions/` instead of `/app/functions/`
- **Solution**: Moved all functions to correct Cloudflare Pages location

### 2. **JWT Verification Hardened**
- Added strict issuer (`iss`) validation
- Added strict audience (`aud`) validation
- Prevents token forgery and replay attacks

### 3. **Dynamic CORS Support**
- Supports multiple origins: `dev.jobhackai.io`, `qa.jobhackai.io`, `app.jobhackai.io`
- Proper origin validation with fallback
- Includes `Vary: Origin` header

### 4. **Standardized Routes**
- `/dashboard.html` → `/dashboard` (301 redirect)
- All Stripe success/cancel URLs use clean routes
- Billing portal return URL uses `/dashboard`

### 5. **Cache Bypass Rules**
- API routes have `Cache-Control: no-store` headers
- Added `_headers` file for Cloudflare Pages
- Prevents stale JWT responses

### 6. **Environment Variables**
All required variables now in `wrangler.toml`:
- `FIREBASE_PROJECT_ID` ✅
- `STRIPE_SECRET_KEY` ✅
- `STRIPE_WEBHOOK_SECRET` ✅
- `PRICE_*_MONTHLY` ✅
- `FRONTEND_URL` ✅

## 🚀 Deployment Steps

### 1. Install Dependencies
```bash
cd app
npm install
```

### 2. Build the Application
```bash
npm run build
```

This will:
- Build Next.js static site
- Copy `_redirects` and `_headers` to output
- Copy HTML, CSS, JS, and assets

### 3. Deploy to Cloudflare Pages

**For QA Environment:**
```bash
npm run deploy:qa
```

**For Production:**
```bash
npm run deploy:prod
```

**Manual Deploy (if needed):**
```bash
wrangler pages deploy out --env production
```

## 🔐 Environment Variable Setup

### In Cloudflare Dashboard:

1. Go to **Pages** → **Your Project** → **Settings** → **Environment Variables**

2. Add these for **QA/Preview**:
   ```
   FIREBASE_PROJECT_ID=jobhackai-qa
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_test_...
   PRICE_ESSENTIAL_MONTHLY=price_...
   PRICE_PRO_MONTHLY=price_...
   PRICE_PREMIUM_MONTHLY=price_...
   ```

3. Add these for **Production**:
   ```
   FIREBASE_PROJECT_ID=jobhackai-prod
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_live_...
   PRICE_ESSENTIAL_MONTHLY=price_...
   PRICE_PRO_MONTHLY=price_...
   PRICE_PREMIUM_MONTHLY=price_...
   ```

## 🧪 Verification Steps

### 1. Test API Endpoint Availability
```bash
# Should return 405 (Method Not Allowed) - proves endpoint exists
curl -X GET https://dev.jobhackai.io/api/plan/me
```

### 2. Test JWT Authentication
```bash
# Get Firebase ID token from browser console:
# firebase.auth().currentUser.getIdToken()

curl -X GET https://dev.jobhackai.io/api/plan/me \
  -H "Authorization: Bearer YOUR_ID_TOKEN"

# Should return: {"plan":"free"} or your actual plan
```

### 3. Test Stripe Checkout
```bash
curl -X POST https://dev.jobhackai.io/api/stripe-checkout \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro"}'

# Should return: {"ok":true,"url":"https://checkout.stripe.com/...","sessionId":"cs_..."}
```

### 4. Test Billing Portal
```bash
curl -X POST https://dev.jobhackai.io/api/billing-portal \
  -H "Authorization: Bearer YOUR_ID_TOKEN"

# Should return: {"ok":true,"url":"https://billing.stripe.com/..."}
```

### 5. Test Dashboard Redirect
```bash
# Should redirect 301 to /dashboard
curl -I https://dev.jobhackai.io/dashboard.html
```

### 6. Test Cache Headers
```bash
# Should have Cache-Control: no-store
curl -I https://dev.jobhackai.io/api/plan/me
```

## 🔍 Troubleshooting

### Issue: API returns 404
**Cause**: Functions not in correct location  
**Fix**: Ensure functions are in `app/functions/api/` not root `functions/api/`

### Issue: JWT verification fails
**Cause**: Missing `FIREBASE_PROJECT_ID` environment variable  
**Fix**: Add to Cloudflare Pages environment variables

### Issue: Stripe checkout fails
**Cause**: Missing Stripe environment variables  
**Fix**: Add `STRIPE_SECRET_KEY` and price IDs to environment variables

### Issue: CORS errors
**Cause**: Origin not in allowlist  
**Fix**: Update `corsHeaders()` function in API files to include your origin

### Issue: Stale API responses
**Cause**: Cloudflare caching API responses  
**Fix**: Verify `_headers` file is deployed and contains API cache rules

## 📁 File Structure

```
app/
├── functions/
│   ├── _lib/
│   │   └── firebase-auth.js     # JWT verification with hardened claims
│   ├── _middleware.js            # QA environment middleware
│   └── api/
│       ├── auth.js               # Basic auth test endpoint
│       ├── billing-portal.js     # Stripe billing portal
│       ├── stripe-checkout.js    # Stripe checkout session
│       ├── stripe-webhook.js     # Stripe webhook handler
│       ├── subscription.js       # Subscription status
│       └── plan/
│           └── me.js             # Get user's plan (JWT-secured)
├── public/
│   ├── _redirects                # Route redirects
│   └── _headers                  # Cache control headers
├── wrangler.toml                 # Environment configuration
└── package.json                  # Build scripts

```

## 🎯 Success Criteria

✅ API endpoints respond (not 404)  
✅ JWT authentication works  
✅ Stripe checkout creates sessions  
✅ Billing portal generates URLs  
✅ Dashboard redirect works (301)  
✅ API responses have `Cache-Control: no-store`  
✅ CORS works for all environments  
✅ Environment variables load correctly  

## 🚨 Security Notes

1. **Never commit secrets** - Use Cloudflare environment variables
2. **JWT verification is strict** - Validates issuer and audience
3. **Webhook signatures verified** - Uses HMAC SHA-256
4. **CORS is restrictive** - Only allows known origins
5. **API responses not cached** - Prevents token leakage

## 📞 Support

If issues persist after following this guide:
1. Check Cloudflare Pages build logs
2. Verify environment variables in Cloudflare dashboard
3. Test with curl commands above
4. Check browser console for CORS errors
5. Review Cloudflare Functions logs

---

**Last Updated**: October 8, 2025  
**Author**: JobHackAI Development Team



