<!-- 0bc5c478-d1c0-40bf-81cd-d7ea8eb937c7 37691ac1-4198-44f9-a017-5be779601a14 -->
# Pre-Merge Bugbot Checklist: dev0 → develop (dev.jobhackai.io → qa.jobhackai.io)

## Environment Variables Verification

### ✅ Variables Confirmed Correct in Both Environments

**Shared Configuration (By Design):**

- `FIREBASE_PROJECT_ID` = `jobhackai-90558` (shared Firebase project)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (encrypted) - shared
- `FIREBASE_WEB_API_KEY` - shared
- `STRIPE_SECRET_KEY` (encrypted) - shared Stripe test mode
- `STRIPE_PUBLISHABLE_KEY` (encrypted) - shared Stripe test mode
- `STRIPE_WEBHOOK_SECRET` (encrypted) - shared
- `STRIPE_PRICE_ESSENTIAL_MONTHLY` - shared test mode prices
- `STRIPE_PRICE_PRO_MONTHLY` - shared test mode prices
- `STRIPE_PRICE_PREMIUM_MONTHLY` - shared test mode prices
- `STRIPE_PORTAL_CONFIGURATION_ID_DEV` = `bpc_1SAiLoApMPhcB1Y67s2CjGWk` - shared
- `JOBHACKAI_KV` binding = `jobhackai-kv-dev-qa-shared` (shared KV namespace)

**Environment-Specific (Correctly Different):**

- `ENVIRONMENT`: DEV=`dev`, QA=`qa` ✅
- `FRONTEND_URL`: DEV=`https://dev.jobhackai.io`, QA=`https://qa.jobhackai.io` ✅
- `STRIPE_CANCEL_URL`: DEV=`https://dev.jobhackai.io/pricing-a?canceled=1`, QA=`https://qa.jobhackai.io/pricing-a?canceled=1` ✅
- `STRIPE_SUCCESS_URL`: DEV=`https://dev.jobhackai.io/dashboard?paid=1`, QA=`https://qa.jobhackai.io/dashboard?paid=1` ✅
- `STRIPE_PORTAL_RETURN_URL`: DEV=`https://dev.jobhackai.io/billing`, QA=`https://qa.jobhackai.io/billing` ✅

### ⚠️ Final Check Required

**Verify in Cloudflare Dashboard before merge:**

1. QA has `STRIPE_PORTAL_CONFIGURATION_ID_DEV` with value `bpc_1SAiLoApMPhcB1Y67s2CjGWk`
2. DEV has `STRIPE_PUBLISHABLE_KEY` (should match QA's value)
3. All encrypted secrets are present in both environments

## Code Quality & Git Status Checks

### Pre-Merge Code Review

1. **Current Branch Status:**

   - Verify `dev0` branch is up to date with remote
   - Check for uncommitted changes (currently: `app/out/404.html` modified)
   - Decision: Commit or discard the `404.html` change before merge

2. **Build Verification on dev0:**
   ```bash
   cd /Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/app
   npm ci
   npm run build
   ```


   - Ensure build completes without errors
   - Verify `out/` directory contains `_headers` and `_redirects`

3. **Linter Checks:**

   - Review any linter errors in modified files
   - Ensure no critical errors introduced in recent changes

## Firebase Configuration Validation

Since both environments share Firebase project `jobhackai-90558`:

1. **Firebase Console Action URL Settings:**

   - Verify authorized domains include both:
     - `dev.jobhackai.io`
     - `qa.jobhackai.io`
   - Check email action URLs are configured for both domains

2. **Firebase Authentication:**

   - Confirm both domains in OAuth redirect whitelist
   - Verify API key restrictions allow both domains

## Stripe Configuration Validation

Both environments use same Stripe test mode by design:

1. **Stripe Webhook Endpoints:**

   - Verify webhook configured for: `https://qa.jobhackai.io/api/stripe-webhook`
   - Ensure events selected:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`

2. **Stripe Portal Configuration:**

   - Confirm `bpc_1SAiLoApMPhcB1Y67s2CjGWk` portal config ID is valid
   - Verify return URLs can handle both dev and qa domains

## Cloudflare Pages Build Configuration

Verify `jobhackai-app-qa` project settings match `jobhackai-app-dev`:

1. **Build Settings:**

   - Build command: `npm ci && npm run build`
   - Build output directory: `/out`
   - Root directory: `/app`
   - Build system version: `3 (latest)`

2. **Branch Configuration:**

   - Production branch: `develop` → deploys to `qa.jobhackai.io`
   - Verify branch name matches exactly

## Security Headers Verification

Ensure security configurations will deploy correctly:

1. **Check `app/public/_headers` exists:**

   - API routes have `Cache-Control: no-store`
   - Security headers present (`X-Content-Type-Options`, `X-Frame-Options`, etc.)

2. **Check `app/public/_redirects` exists:**

   - Dashboard redirect rules present
   - No conflicting redirect patterns

## Pre-Merge Git Operations

1. **Create Pull Request:**

   - Source: `dev0` → Target: `develop`
   - Title: "Merge dev0 to develop - [Brief description of changes]"
   - Include reference to latest commit on dev0: `ec005e3`

2. **PR Description Should Include:**

   - Summary of changes since last QA deployment
   - Any breaking changes or migration notes
   - Environment variables verified matching
   - Links to related issues/PRs

## Post-Merge Deployment Verification

Once PR is merged and Cloudflare auto-deploys to `qa.jobhackai.io`:

### Automated Endpoint Checks

1. **API Health Check:**
   ```bash
   curl https://qa.jobhackai.io/api/health-env
   ```


   - Should return all environment variables with `exists: true`

2. **Basic API Endpoints:**
   ```bash
   # Should return 401 (not 404)
   curl -X GET https://qa.jobhackai.io/api/plan/me
   
   # Should return method not allowed
   curl -X GET https://qa.jobhackai.io/api/stripe-checkout
   ```

3. **Cache Headers:**
   ```bash
   curl -I https://qa.jobhackai.io/api/plan/me | grep -i cache-control
   ```


   - Should show: `Cache-Control: no-store`

### Authentication Flow Tests

1. **Login Flow:**

   - Navigate to `https://qa.jobhackai.io/login.html`
   - Test login with Firebase account
   - Verify redirect to dashboard

2. **Email Verification Flow:**

   - Test email verification links point to `qa.jobhackai.io`
   - Verify action URL handler at `/auth/action` works

3. **Password Reset Flow:**

   - Test forgot password flow
   - Ensure reset links use `qa.jobhackai.io` domain

### Stripe Integration Tests

1. **Checkout Flow (with test card):**

   - Navigate to pricing page
   - Initiate checkout for a plan
   - Use test card: `4242 4242 4242 4242`
   - Verify redirect back to `https://qa.jobhackai.io/dashboard?paid=1`

2. **Billing Portal:**

   - From dashboard, click "Manage Billing"
   - Verify portal loads
   - Check return URL redirects to `qa.jobhackai.io/billing`

3. **Webhook Verification:**

   - Complete a test checkout on QA
   - Check Cloudflare Functions logs for webhook receipt
   - Verify subscription status updates in Firestore

### Cross-Environment Isolation Test

**Critical:** Ensure QA and DEV don't interfere with each other:

1. **KV Namespace Isolation:**

   - Since KV is shared (`jobhackai-kv-dev-qa-shared`), verify keys are properly namespaced
   - Check that QA users don't see DEV data and vice versa

2. **Firebase User Isolation:**

   - Verify users can authenticate on both environments independently
   - Check that plan changes on QA don't affect DEV

## Rollback Plan

If critical issues found post-deployment:

1. **Immediate Rollback:**
   ```bash
   # Revert the merge commit on develop branch
   git revert <merge_commit_hash>
   git push origin develop
   ```

2. **Cloudflare Manual Rollback:**

   - Go to Cloudflare Pages → jobhackai-app-qa → Deployments
   - Find previous successful deployment
   - Click "Rollback to this deployment"

3. **Notify team of rollback and document issues**

## Success Criteria

All checks must pass before merge is considered successful:

- [ ] All environment variables verified in both DEV and QA
- [ ] Build completes successfully on dev0 branch
- [ ] No critical linter errors
- [ ] Firebase domains configured for both environments
- [ ] Stripe webhooks configured for QA
- [ ] Git branch is clean and up to date
- [ ] PR created with proper description
- [ ] Post-merge deployment succeeds on Cloudflare
- [ ] API endpoints return expected responses (not 404)
- [ ] Authentication flows work on QA
- [ ] Stripe checkout and billing portal work on QA
- [ ] No cross-environment data leakage
- [ ] All security headers present in responses

## Key Files to Monitor

These files are critical to the deployment:

- `app/wrangler.local.toml` - Local config reference
- `app/package.json` - Build scripts
- `app/public/_headers` - Security headers
- `app/public/_redirects` - Route redirects
- `app/functions/_lib/firebase-auth.js` - JWT verification
- `app/functions/api/*` - All API endpoints

## Notes

- **Memory Reference:** Following safest defaults for auth hardening [[memory:10372789]]
- DEV environment (`dev0` → `dev.jobhackai.io`) is the source of truth
- QA environment (`develop` → `qa.jobhackai.io`) should mirror DEV configuration
- Both environments intentionally share: Firebase project, Stripe test mode, KV namespace
- Deploy happens automatically when PR is merged to `develop` branch

### To-dos

- [ ] Verify all environment variables in Cloudflare dashboard for both dev and qa environments match checklist
- [ ] Review and handle modified app/out/404.html file, ensure dev0 branch is clean
- [ ] Run build on dev0 branch and verify output directory contains required files
- [ ] Create pull request from dev0 to develop with comprehensive description
- [ ] After merge, run smoke tests on qa.jobhackai.io including API, auth, and Stripe flows