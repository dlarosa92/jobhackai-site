# Quick Reference: JWT-Secured APIs

## 🚀 Deploy in 3 Steps

```bash
# 1. Install dependencies
cd app && npm install

# 2. Build
npm run build

# 3. Deploy
npm run deploy:qa     # For QA
npm run deploy:prod   # For production
```

## 🧪 Test in 30 Seconds

```bash
# Quick verification
cd app
./scripts/verify-deployment.sh dev

# Test with JWT
curl -H "Authorization: Bearer $TOKEN" \
  https://dev.jobhackai.io/api/plan/me
```

## 📦 What Changed

| Change | Why | File |
|--------|-----|------|
| Moved functions to `app/functions/` | Fix 404 errors | All API files |
| Added strict JWT claims | Prevent forgery | `firebase-auth.js` |
| Dynamic CORS | Support all envs | All API files |
| Standardized routes | Consistency | `_redirects` |
| Cache bypass | Fresh tokens | `_headers` |
| Environment vars | No manual setup | `wrangler.toml` |

## 🔐 Environment Variables

**Set once in Cloudflare Dashboard**: Pages → Settings → Environment Variables

```bash
# Required for QA
FIREBASE_PROJECT_ID=jobhackai-qa
STRIPE_WEBHOOK_SECRET=whsec_test_...
PRICE_ESSENTIAL_MONTHLY=price_...
PRICE_PRO_MONTHLY=price_...
PRICE_PREMIUM_MONTHLY=price_...

# Required for Production
FIREBASE_PROJECT_ID=jobhackai-prod
STRIPE_WEBHOOK_SECRET=whsec_live_...
PRICE_ESSENTIAL_MONTHLY=price_...
PRICE_PRO_MONTHLY=price_...
PRICE_PREMIUM_MONTHLY=price_...
```

## 🎯 API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/plan/me` | GET | ✅ | Get user's plan |
| `/api/stripe-checkout` | POST | ✅ | Create checkout session |
| `/api/billing-portal` | POST | ✅ | Get billing portal URL |
| `/api/stripe-webhook` | POST | ❌* | Stripe webhooks |
| `/api/auth` | POST | ❌ | Test endpoint |
| `/api/subscription` | POST | ❌ | Get subscription status |

*Webhook uses HMAC signature, not JWT

## 🔍 Troubleshooting

| Problem | Solution |
|---------|----------|
| 404 on API | Check functions are in `app/functions/` |
| JWT fails | Set `FIREBASE_PROJECT_ID` in Cloudflare |
| CORS error | Add origin to `corsHeaders()` |
| Stripe fails | Set `STRIPE_SECRET_KEY` |
| Cached responses | Verify `_headers` deployed |

## 📝 Common Commands

```bash
# Build
cd app && npm run build

# Deploy to QA
npm run deploy:qa

# Deploy to production
npm run deploy:prod

# Verify deployment
./scripts/verify-deployment.sh dev

# Test API
curl -I https://dev.jobhackai.io/api/plan/me

# Get JWT token (browser console)
firebase.auth().currentUser.getIdToken()

# Test with JWT
curl -H "Authorization: Bearer $TOKEN" \
  https://dev.jobhackai.io/api/plan/me
```

## 📁 File Locations

```
app/
├── functions/          # ✅ API endpoints (correct location)
│   ├── _lib/
│   │   └── firebase-auth.js
│   └── api/
│       ├── plan/me.js
│       ├── stripe-checkout.js
│       ├── billing-portal.js
│       └── stripe-webhook.js
├── public/
│   ├── _redirects     # Route rules
│   └── _headers       # Cache rules
└── wrangler.toml      # Environment config
```

## ✅ Success Criteria

- [ ] API returns 401 (not 404)
- [ ] JWT auth works
- [ ] Stripe checkout creates sessions
- [ ] Billing portal generates URLs
- [ ] Dashboard redirect works
- [ ] No cache on API responses
- [ ] CORS works from browser

## 🎉 Zero Manual Steps

After initial environment variable setup in Cloudflare, everything is automated:
- ✅ Build copies `_redirects` and `_headers`
- ✅ All environment variables in `wrangler.toml`
- ✅ CORS configured for all environments
- ✅ Cache rules applied automatically
- ✅ Routes standardized via `_redirects`

---

**For detailed guide**: See `app/DEPLOYMENT.md`  
**For full summary**: See `IMPLEMENTATION_SUMMARY.md`



