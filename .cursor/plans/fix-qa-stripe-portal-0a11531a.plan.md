<!-- 0a11531a-7d75-442c-a8fc-91ec79d3f155 4b8d0337-0c46-4e97-af3c-131bfe2e9f0a -->
# Dev0 Stripe Cancellation Display & Portal Config Plan

### Scope

- Target branch: `dev0` (dev.jobhackai.io deploys from this branch)
- Only edit `app/functions` (Cloudflare Pages Functions) and frontend HTML/JS
- Leave `develop`/QA as-is

### Current State (Completed in Previous Deployment)

✅ 500 errors resolved
✅ Checkout prompts for card on all plans (including trial)
✅ Trial subscriptions correctly marked and stored
✅ Multiple trials prevented via KV store check
✅ Dashboard/Account Settings update from Stripe subscription status

### New Issue: Cancellation Info Not Displaying

**Problem:** When user cancels subscription in Stripe portal (e.g., "Your subscription will be canceled on November 18, 2025"), this information does NOT appear in Dashboard or Account Settings UI. Currently shows active plan without pending cancellation warning.

**Root Cause:** 
- Webhook handles `customer.subscription.deleted` (after cancellation completes) but not `customer.subscription.updated` with `cancel_at_period_end=true` (when cancellation is scheduled)
- `/api/plan/me` and `/api/sync-stripe-plan` don't return cancellation timestamp
- Frontend has no logic to display cancellation warnings

### Changes to Make on dev0

1) **app/functions/api/stripe-webhook.js**

- Add handler for `customer.subscription.updated` event
- Detect when `cancel_at_period_end === true` in subscription object
- Store `cancelAtByUid:${uid}` with `cancel_at` timestamp in KV
- Clear `cancelAtByUid:${uid}` if subscription is reactivated (cancel_at_period_end becomes false)
- Keep plan as current tier (pro/essential/premium) until actual deletion

2) **app/functions/api/plan/me.js**

- Read `cancelAtByUid:${uid}` from KV
- Return `cancelAt` field in JSON response (ISO timestamp or null)
- Format: `{ plan: 'pro', trialEndsAt: null, cancelAt: '2025-11-18T00:00:00.000Z' }`

3) **app/functions/api/sync-stripe-plan.js**

- Query Stripe subscription and check `cancel_at_period_end` and `cancel_at` fields
- Store `cancelAtByUid:${uid}` in KV if cancellation is pending
- Return `cancelAt` in response payload

4) **dashboard.html**

- After fetching plan data, check for `cancelAt` field
- If present, display warning banner: "⚠️ Your subscription will be canceled on [formatted date]. You'll have access until then."
- Position banner near plan badge or in welcome section

5) **account-setting.html**

- In subscription section (line 283-286), check for `cancelAt` from API
- Display: "Pro Plan • $59/mo • Cancels on Nov 18, 2025"
- Add "Don't cancel" button that redirects to Stripe portal (optional)
- Fix `UserProfileManager is not defined` error (line 494) by checking for missing script imports

### Stripe Portal Configuration (Answer to UX Question)

**Yes, you MUST configure the Stripe Customer Portal in Stripe Dashboard:**

1. **Navigate to Stripe Dashboard** (test mode for dev environment)
2. **Go to Settings > Customer portal**
3. **Enable "Subscription updates":**
   - Check "Allow customers to switch plans"
   - Select products: JobHackAI Essential, JobHackAI Pro, JobHackAI Premium
   - Set upgrade/downgrade rules (e.g., prorate charges, allow all combinations)
4. **Enable "Subscription cancellation":**
   - Allow customers to cancel subscriptions
   - Choose cancellation behavior (cancel at period end vs immediate)
5. **Save configuration** and copy the Configuration ID (format: `bpc_...`)
6. **Set environment variable** in Cloudflare Pages:
   - `STRIPE_PORTAL_CONFIGURATION_ID_DEV = bpc_xxxxxxxxxxxxx`

**Important:** The portal pulls available plans from Stripe's Product Catalog, NOT from your pricing-a.html page. The pricing page is for initial signup; the portal is for managing existing subscriptions.

### Environment Prerequisites (dev project)

- FRONTEND_URL = `https://dev.jobhackai.io`
- STRIPE_SECRET_KEY = test key for dev
- STRIPE_PRICE_ESSENTIAL_MONTHLY, STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PREMIUM_MONTHLY set
- FIREBASE_PROJECT_ID = dev project id
- JOBHACKAI_KV binding present
- STRIPE_PORTAL_CONFIGURATION_ID_DEV = `bpc_...` (create in Stripe Dashboard as above)
- STRIPE_WEBHOOK_SECRET = whsec_... for webhook signature verification

### Execution Steps

1. **Update webhook handler** (`app/functions/api/stripe-webhook.js`):
   - Add `customer.subscription.updated` event handler
   - Check `event.data.object.cancel_at_period_end` field
   - Store `cancelAtByUid:${uid}` with `event.data.object.cancel_at` timestamp
   - Log cancellation detection for debugging

2. **Update plan API** (`app/functions/api/plan/me.js`):
   - Read `cancelAtByUid:${uid}` from KV
   - Add `cancelAt` field to JSON response
   - Format timestamp as ISO string

3. **Update sync API** (`app/functions/api/sync-stripe-plan.js`):
   - Check `latestSub.cancel_at_period_end` from Stripe
   - Store `cancelAt` in KV if true
   - Return in response payload

4. **Update dashboard UI** (`dashboard.html`):
   - Fetch plan data including `cancelAt`
   - Display warning banner if `cancelAt` exists
   - Format date for user readability

5. **Update account settings UI** (`account-setting.html`):
   - Modify subscription section to show cancellation info
   - Display "Cancels on [date]" if `cancelAt` present
   - Fix `UserProfileManager` error

6. **Commit and deploy**:
   - Commit msg: "dev0: add subscription cancellation display and portal config support"
   - `git push origin dev0` to trigger dev deployment
   - Wait 35s for Cloudflare deployment

7. **Test cancellation flow**:
   - Subscribe to Pro plan
   - Cancel in Stripe portal
   - Verify webhook receives `customer.subscription.updated`
   - Check Dashboard shows "Your subscription will be canceled on [date]"
   - Check Account Settings shows cancellation info
   - Verify plan remains active until cancellation date

### Risk Controls / Rollback

- If webhook changes break, revert commit on `dev0` and push
- Frontend changes are non-breaking (only add new UI elements)
- KV storage is additive (new keys don't affect existing data)
- QA/production remain unaffected (different branch `develop`)

### Success Criteria

- Webhook logs show `customer.subscription.updated` with `cancel_at_period_end` detection
- `/api/plan/me` returns `cancelAt` field when subscription is pending cancellation
- Dashboard displays cancellation warning banner with formatted date
- Account Settings shows "Cancels on [date]" in subscription section
- Cancellation info disappears after subscription is reactivated in portal
- Plan remains at current tier (pro/premium) until actual cancellation date