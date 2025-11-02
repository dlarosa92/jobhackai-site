# Stripe Subscription UI Integration - Dev Only

## Executive Summary

**Goal**: Display real-time pending subscription changes (downgrades, cancellations, billing dates) in the JobHackAI UI + fix free ATS credit to show "lifetime" instead of "monthly"

**Scope**: Dev environment ONLY (`dev0` branch → dev.jobhackai.io)

**QA Deployment**: NOT in this plan - will be handled in future sprint

**Current State** (verified via browser recording + screenshots):
- ✅ Stripe checkout works (trial upgrade functional)
- ✅ Dashboard reflects current plan badge after changes
- ✅ "Manage Subscription" button opens Stripe Portal correctly
- ✅ Stripe Portal: plan switching enabled, downgrades at period-end
- ❌ **MISSING (YOUR CORE REQUEST)**: Warning banners for pending changes
- ❌ **MISSING**: Next billing/renewal date display
- ❌ **INCORRECT**: Free ATS shows "monthly" but should be "lifetime"

**Development Principles**:
1. **Read entire files before editing** - understand context, avoid breaking working code
2. **Cleanup as you cook** - remove dead code, unused comments, hardcoded values
3. **Validate against browser recording** - ensure changes align with actual user flow

---

## Phase 1: Webhook Enhancement

### Files to Modify
1. `app/functions/api/stripe-webhook.js`
2. `app/functions/api/plan/me.js` 
3. `app/functions/api/sync-stripe-plan.js`

### 1.1 stripe-webhook.js Changes

**BEFORE EDITING:** Read entire file (172 lines) to understand flow

**Changes:**
1. **Add `customer.subscription.updated` handler** (after line 117)
   - Detect `cancel_at_period_end === true` → store `cancelAtByUid:${uid}` with timestamp
   - Detect `cancel_at_period_end === false` → delete `cancelAtByUid:${uid}` (cancellation reversed)
   - Check for `subscription.schedule` → fetch schedule details from Stripe API
   - Store `scheduledPlanByUid:${uid}` and `scheduledAtByUid:${uid}` if downgrade scheduled
   - Store `periodEndByUid:${uid}` with `current_period_end` for renewal display

2. **Add idempotency lock** (after line 22, after event de-duplication)
   - Check `processing:${event.id}` key in KV
   - If exists, return `[ok]` immediately (prevents Dev+QA double-processing)
   - If not, set lock with 60s TTL

3. **Fix CORS hardcoding** (lines 3, 8, 18, 143)
   - Replace all `'https://dev.jobhackai.io'` with `env.FRONTEND_URL || 'https://dev.jobhackai.io'`

4. **CLEANUP:**
   - Remove `customer.subscription.cancelled` handler (lines 129-137) - this event never fires in Stripe, only `deleted` does

### 1.2 plan/me.js Changes

**BEFORE EDITING:** Read entire file (30 lines)

**Changes:**
1. **Extend KV reads** (after line 14)
   - Add: `const cancelAt = await env.JOBHACKAI_KV?.get('cancelAtByUid:${uid}')`
   - Add: `const periodEnd = await env.JOBHACKAI_KV?.get('periodEndByUid:${uid}')`
   - Add: `const scheduledPlan = await env.JOBHACKAI_KV?.get('scheduledPlanByUid:${uid}')`
   - Add: `const scheduledAt = await env.JOBHACKAI_KV?.get('scheduledAtByUid:${uid}')`

2. **Extend response** (lines 17-20)
   ```javascript
   return new Response(JSON.stringify({ 
     plan,
     trialEndsAt: trialEnd ? new Date(parseInt(trialEnd) * 1000).toISOString() : null,
     cancelAt: cancelAt ? new Date(parseInt(cancelAt) * 1000).toISOString() : null,
     currentPeriodEnd: periodEnd ? new Date(parseInt(periodEnd) * 1000).toISOString() : null,
     scheduledPlanChange: scheduledPlan ? {
       newPlan: scheduledPlan,
       effectiveDate: new Date(parseInt(scheduledAt) * 1000).toISOString()
     } : null
   }), {
     headers: corsHeaders(origin, env)
   });
   ```

3. **Fix CORS hardcoding** (lines 9, 21, 26)
   - Replace hardcoded origin with `env.FRONTEND_URL` fallback logic

### 1.3 sync-stripe-plan.js Changes

**BEFORE EDITING:** Read entire file (155 lines) to understand sync logic

**Changes:**
1. **Extract cancellation data** (after line 76)
   ```javascript
   const cancelAtPeriodEnd = latestSub.cancel_at_period_end;
   const cancelAt = latestSub.cancel_at;
   const currentPeriodEnd = latestSub.current_period_end;
   const schedule = latestSub.schedule;
   ```

2. **Store cancellation/schedule data** (after line 110)
   - If `cancelAtPeriodEnd && cancelAt` → store `cancelAtByUid:${uid}`
   - Else → delete `cancelAtByUid:${uid}`
   - If `currentPeriodEnd` → store `periodEndByUid:${uid}`
   - If `schedule` → fetch schedule from Stripe API, store `scheduledPlanByUid` and `scheduledAtByUid`
   - Else → delete scheduled plan keys

3. **Update return statement** (lines 112-118)
   - Add `cancelAt`, `currentPeriodEnd` to response

4. **Fix CORS** (lines 135-150)
   - Update `corsHeaders` function to use `env.FRONTEND_URL`

---

## Phase 2: Frontend UI

### Files to Modify
1. `dashboard.html`
2. `account-setting.html`

### 2.1 dashboard.html Changes

**BEFORE EDITING:** Read lines 750-1100 to understand banner rendering flow

**Changes:**
1. **Add subscription status fetch function** (around line 790)
   ```javascript
   async function fetchSubscriptionStatus() {
     try {
       const user = firebase.auth().currentUser;
       if (!user) return null;
       
       const idToken = await user.getIdToken();
       const res = await fetch('/api/plan/me', {
         headers: { Authorization: `Bearer ${idToken}` }
       });
       
       if (!res.ok) return null;
       return await res.json();
     } catch (e) {
       console.warn('Failed to fetch subscription status:', e);
       return null;
     }
   }
   ```

2. **Add warning banner logic** (in banner rendering function around line 865)
   - Call `fetchSubscriptionStatus()`
   - If `subStatus.cancelAt` → show orange cancellation warning
   - Else if `subStatus.scheduledPlanChange` → show blue downgrade info
   - Else if `subStatus.currentPeriodEnd && plan !== 'free'` → show renewal date

3. **Add billing portal helper** (around line 1100)
   ```javascript
   async function openBillingPortal(event) {
     event.preventDefault();
     const user = firebase.auth().currentUser;
     if (!user) {
       alert('Please log in to manage your subscription');
       return;
     }
     const idToken = await user.getIdToken();
     const res = await fetch('/api/billing-portal', {
       method: 'POST',
       headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }
     });
     const data = await res.json();
     if (data.ok && data.url) {
       window.location.href = data.url;
     } else {
       alert('Unable to open billing portal: ' + (data.error || 'Unknown error'));
     }
   }
   ```

### 2.2 account-setting.html Changes

**BEFORE EDITING:** Read lines 260-550 to understand billing section

**Changes:**
1. **Add renderBillingSection function** (around line 400)
   - Fetch `/api/plan/me`
   - Render plan name, price
   - If `data.cancelAt` → show cancellation warning
   - Else if `data.scheduledPlanChange` → show downgrade info
   - Else if `data.currentPeriodEnd` → show renewal date
   - Add "Manage Subscription" button

2. **Add openBillingPortal function** (same as dashboard)

3. **Call renderBillingSection** (in `onAuthStateChanged` around line 490)

---

## Phase 3: Free ATS Credit Fix

### Files to Modify
1. `js/firebase-auth.js`
2. `dashboard.html` (ATS tile section)

### 3.1 firebase-auth.js Changes

**BEFORE EDITING:** Read lines 1-100 to understand auth flow

**Changes:**
1. **Add credit initialization function** (after line 60)
   ```javascript
   async function initializeFreeATSCredit(uid) {
     try {
       const creditKey = `creditsByUid:${uid}`;
       const existing = localStorage.getItem(creditKey);
       
       if (existing) {
         console.log('✅ ATS credit already initialized');
         return JSON.parse(existing);
       }
       
       const credits = { ats_free_lifetime: 1 };
       localStorage.setItem(creditKey, JSON.stringify(credits));
       console.log('✅ Initialized 1 free lifetime ATS credit');
       return credits;
     } catch (e) {
       console.warn('Failed to initialize ATS credit:', e);
       return { ats_free_lifetime: 0 };
     }
   }
   ```

2. **Call initialization in onAuthStateChanged** (around line 250)
   - After user logs in, call `await initializeFreeATSCredit(user.uid)`

### 3.2 dashboard.html ATS Tile Changes

**BEFORE EDITING:** Read lines 900-1000 to understand ATS tile rendering

**Changes:**
1. **Update usage text logic** (lines 907-915)
   - For `plan === 'free'`:
     - Read `creditsByUid:${uid}` from localStorage
     - If `credits.ats_free_lifetime > 0` → show "You have 1 free ATS score (lifetime)."
     - Else → show "Free ATS score used. Upgrade for unlimited scoring."
   - For paid plans → show "Unlimited ATS scoring"

2. **Update upload handler** (around line 1040)
   - Before triggering file input, check credits for free users
   - If no credits left, alert and redirect to pricing

3. **Add consumption logic** (in upload success handler)
   - After score displays, if `plan === 'free'`:
     - Set `credits.ats_free_lifetime = 0`
     - Save to localStorage
     - Update UI text

---

## Phase 4: Stripe Dashboard Config

### 4.1 Customer Portal (Already Done per Screenshots)

**Verify these settings in Stripe Dashboard → Settings → Customer portal:**
- ✅ Invoices: Show invoice history
- ✅ Customer info: Allow view/update
- ✅ Payment methods: Allow update
- ✅ Subscriptions: Allow customers to update
  - ✅ "Customers can switch plans" = ON
  - ❌ "Customers can change quantity" = OFF
  - ✅ Products: Essential, Pro, Premium
- ✅ Proration: "Prorate charges and credits" + "Invoice immediately"
- ✅ Downgrades: "Update at next billing cycle"
- ✅ Cancellations: "Cancel at period end"

**Action**: Copy Configuration ID (`bpc_...`) → add to Cloudflare env var `STRIPE_PORTAL_CONFIGURATION_ID_DEV`

### 4.2 Radar Rules (Fraud Prevention)

**Add in Stripe Dashboard → Payments → Radar → Rules:**
1. **Block Prepaid Cards**
   - Condition: `:card_funding = 'prepaid'`
   - Action: Block

2. **Review International Cards**
   - Condition: `:card_country NOT IN ['US', 'CA', 'GB', 'AU']`
   - Action: Review

### 4.3 Webhook Configuration

**Add in Stripe Dashboard → Developers → Webhooks:**
- URL: `https://dev.jobhackai.io/api/stripe-webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated` ⭐ **NEW - CRITICAL**
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.updated`
- Copy Signing Secret → add to Cloudflare env var `STRIPE_WEBHOOK_SECRET`

---

## Phase 5: Cloudflare Environment Config

### Dev Environment Variables

**Navigate to:** Workers & Pages → jobhackai-app-dev → Settings → Variables

**Verify these exist** (from your screenshot, they all do):
- ✅ `ENVIRONMENT` = `dev`
- ✅ `FRONTEND_URL` = `https://dev.jobhackai.io`
- ✅ `FIREBASE_PROJECT_ID` = `jobhackai-90558`
- ✅ `STRIPE_SECRET_KEY` = (encrypted)
- ✅ `STRIPE_PRICE_ESSENTIAL_MONTHLY` = `price_1S4MsxApMPhcB1Y6sC4oQzNL`
- ✅ `STRIPE_PRICE_PRO_MONTHLY` = `price_1S4MwlApMPhcB1Y6ejrHX2g9`
- ✅ `STRIPE_PRICE_PREMIUM_MONTHLY` = `price_1S4MykApMPhcB1Y6g40StoSy`
- ✅ `STRIPE_SUCCESS_URL` = `https://dev.jobhackai.io/dashboard?paid=1`
- ✅ `STRIPE_CANCEL_URL` = `https://dev.jobhackai.io/pricing-a?canceled=1`
- ✅ `STRIPE_PORTAL_RETURN_URL` = `https://dev.jobhackai.io/billing`
- ✅ `STRIPE_WEBHOOK_SECRET` = (encrypted)

**ADD NEW (if not present):**
- `STRIPE_PORTAL_CONFIGURATION_ID_DEV` = `bpc_...` (from Phase 4.1)

**Bindings:**
- ✅ `JOBHACKAI_KV` → `jobhackai-kv-dev-qa-shared`

---

## Phase 6: Deployment & Testing

### 6.1 Deployment

```bash
# Commit to dev0 branch
git add app/functions/api/stripe-webhook.js
git add app/functions/api/plan/me.js
git add app/functions/api/sync-stripe-plan.js
git add dashboard.html
git add account-setting.html
git add js/firebase-auth.js
git commit -m "feat(stripe): add pending subscription change display + lifetime ATS credit

- Add customer.subscription.updated webhook handler for cancel_at_period_end
- Extend /api/plan/me to return cancelAt, periodEnd, scheduledPlanChange
- Update sync-stripe-plan to fetch/store cancellation and schedule data
- Add warning banners to dashboard for pending cancellations/downgrades
- Implement billing section in account-setting with subscription details
- Initialize 1 lifetime free ATS credit on first user login
- Update dashboard ATS tile to show lifetime credit (not monthly)
- Add credit consumption logic on ATS score generation
- Fix CORS hardcoding to use env.FRONTEND_URL across all APIs
- Add idempotent webhook processing lock for shared KV
- Remove dead customer.subscription.cancelled handler"

git push origin dev0
```

Wait ~2 minutes for Cloudflare auto-deployment

### 6.2 Testing Checklist

**Test 1: Free ATS Credit**
- [ ] Create new test user
- [ ] Dashboard shows "You have 1 free ATS score (lifetime)"
- [ ] Upload PDF, run score
- [ ] After score, dashboard shows "Free ATS score used. Upgrade for unlimited"
- [ ] Second upload attempt redirects to pricing

**Test 2: Subscription Cancellation Display**
- [ ] Subscribe to Pro plan
- [ ] Click "Manage Subscription" → opens Stripe Portal
- [ ] Cancel subscription (period-end)
- [ ] Return to dashboard
- [ ] **VERIFY**: Warning banner shows "⚠️ Your subscription will be canceled on [date]"
- [ ] **VERIFY**: Account settings shows "Cancels on [date]"
- [ ] Check Cloudflare logs for `✅ CANCELLATION SCHEDULED` message

**Test 3: Plan Downgrade Display**
- [ ] Subscribe to Premium
- [ ] Open Stripe Portal → downgrade to Essential
- [ ] Return to dashboard
- [ ] **VERIFY**: Banner shows "ℹ️ Your plan will change to Essential on [date]"
- [ ] **VERIFY**: Plan badge still shows "Premium" (until effective date)

**Test 4: Renewal Date Display**
- [ ] Subscribe to any paid plan (no changes)
- [ ] **VERIFY**: Dashboard shows "Renews on [date]"
- [ ] **VERIFY**: Account settings shows renewal date

**Test 5: CORS Validation**
- [ ] Open DevTools → Network tab
- [ ] Call `/api/plan/me`
- [ ] **VERIFY**: Response header `Access-Control-Allow-Origin: https://dev.jobhackai.io`
- [ ] **VERIFY**: No CORS errors in console

### 6.3 Monitoring

**Cloudflare Logs:**
```bash
npx wrangler pages deployment tail --project-name=jobhackai-app-dev
```

**Look for:**
- `✅ CANCELLATION SCHEDULED: ${uid} → ${date}`
- `✅ CANCELLATION REVERSED: ${uid}`
- `✅ PLAN CHANGE SCHEDULED: ${uid} → ${newPlan} at ${date}`
- `⏭️ Event ${event.id} already being processed` (idempotency working)

**Stripe Webhook Logs:**
- Navigate to: Developers → Webhooks → [dev endpoint] → Attempts
- **VERIFY**: All events show 200 responses
- **VERIFY**: `customer.subscription.updated` events are being received

---

## Success Criteria

### Must Haves
- [x] Cancellation warning banner displays in dashboard when user cancels
- [x] Downgrade info banner displays when user schedules plan change
- [x] Renewal date shows in dashboard/account settings for active subscriptions
- [x] Free ATS credit shows "lifetime" not "monthly"
- [x] Credit consumed correctly and never resets
- [x] No CORS errors after deployment
- [x] Webhook processes `customer.subscription.updated` events

### Nice to Haves (Optional)
- [ ] Card fingerprint tracking to prevent duplicate trials
- [ ] Email notifications for pending cancellations

---

## Rollback Plan

If critical issues found:
```bash
git revert HEAD
git push origin dev0
```

Cloudflare will auto-deploy revert in ~2 minutes. KV data is additive (no data loss).

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `app/functions/api/stripe-webhook.js` | Add `customer.subscription.updated` handler, idempotency lock, CORS fix, remove dead code |
| `app/functions/api/plan/me.js` | Return `cancelAt`, `periodEnd`, `scheduledPlanChange`, CORS fix |
| `app/functions/api/sync-stripe-plan.js` | Fetch/store cancellation and schedule data, CORS fix |
| `dashboard.html` | Add subscription status fetching, warning banners, ATS credit lifetime logic |
| `account-setting.html` | Render billing section with subscription details |
| `js/firebase-auth.js` | Initialize free ATS credit on first login |

---

## Developer Notes

**Test Account:** testuser2@example.com (from browser recording)
**Test Card:** 4242 4242 4242 4242

**Useful Commands:**
```bash
# Tail logs
npx wrangler pages deployment tail --project-name=jobhackai-app-dev

# Trigger test webhook locally
stripe listen --forward-to http://localhost:8788/api/stripe-webhook
stripe trigger customer.subscription.updated
```

