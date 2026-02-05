<!-- b94bb483-6af4-456c-b629-33499ce37063 937e31dd-9319-44cc-b07b-2b2ed4778221 -->
# Stripe-driven trial truth + verify-email UX

## Goals

- Use Stripe as source of truth for plan and trial across UI
- Prevent verify-email tab from re-triggering checkout or sending users to pricing after they already subscribed/trialed
- Clear lingering plan banner and selectedPlan state after checkout

## Changes

### 1) New API: billing-status

- File: `functions/api/billing-status.js` (+ mirror in `app/functions/api/billing-status.js` if needed)
- Auth: Firebase ID token (Bearer) required
- Logic:
  - Find Stripe customer by Firebase UID in `metadata.uid` (fallback by email)
  - Get latest active subscription (or trialing) and derive:
    - `plan`: one of `trial | essential | pro | premium | free`
    - `status`: `trialing | active | past_due | canceled | none`
    - `trialEndsAt` (epoch), `currentPeriodEnd`, `hasDefaultPaymentMethod`
  - Return JSON `{ ok: true, plan, status, trialEndsAt, currentPeriodEnd }`
- Implementation: reuse existing REST helper from `functions/api/stripe-checkout.js` (the `stripe(env, path, init)` wrapper) to call Stripe endpoints.

### 2) Verify-email UX hardening

- File: `js/verify-email.js`
- Before calling `/api/stripe-checkout`, first call `/api/billing-status`:
  - If `{status: 'trialing'|'active'}`: redirect to `dashboard.html` and clear `selectedPlan` (both storages). Do NOT start checkout.
  - Else: proceed with existing checkout code (planRequiresPayment → `/api/stripe-checkout`).
- Change “I’ve already verified, continue →” handler to the same logic above (no more pricing fallback when already subscribed).
- If `window.opener` exists, close it after redirect is scheduled.

### 3) Clear selectedPlan post-checkout on landing

- File: `dashboard.html` (DOMContentLoaded script)
- On arrival, immediately:
  - If URL has `paid=1`, clear `selectedPlan` from both storages
  - Call `/api/billing-status`; write `localStorage.user-plan` and `localStorage.dev-plan` to the value from API; keep also `trial-ends-at` for UI

### 4) Dashboard UI driven by billing-status

- File: `dashboard.html`
- Replace any local heuristics with API result:
  - Show plan badge `Trial` when `status='trialing'` with days left from `trialEndsAt`
  - Show `Essential/Pro/Premium` only when subscription active without trial
  - Remove assumptions that default to `essential`

### 5) Account settings sync

- File: `account-setting.html` (or its inline script)
- On load, call `/api/billing-status` and display plan and trial state (kept in sync with Stripe). Keep existing “Manage Subscription” portal link behavior.

### 6) Pricing/Login banner cleanup

- Already added: `beforeunload` and logout clear; ensure after successful checkout:
  - `verify-email.js` and `dashboard.html` both clear `selectedPlan` to avoid re-checkout from the old tab.

### 7) Tests (manual)

- New email/password signup → trial → verification → Stripe → dashboard shows `Trial` with countdown
- Returning to verify-email tab → clicking “I’ve already verified” → goes to dashboard (no pricing)
- Logout/login again → no green signup banner; dashboard still `Trial`
- Google auth + plan selection unaffected

## Minimal snippets

- `billing-status` core (pseudo):
```js
const sub = await stripe(env, '/v1/subscriptions?customer='+custId+'&status=all');
// choose latest where status in [trialing, active]; map price/product id to plan key
return { ok:true, plan, status, trialEndsAt: sub.trial_end*1000 };
```

- `verify-email.js` check before checkout:
```js
const r = await fetch('/api/billing-status',{headers:{Authorization:`Bearer ${idToken}`}});
const b = await r.json();
if (b.ok && (b.status==='trialing'||b.status==='active')) {
  sessionStorage.removeItem('selectedPlan'); localStorage.removeItem('selectedPlan');
  return location.replace('dashboard.html');
}
// else fallback to existing checkout logic
```


## Risks / mitigations

- Stripe lookup by UID requires we set `metadata.uid` during checkout session creation (verify and add if missing)
- Race on immediate redirect after Stripe: handled by dashboard’s post-landing sync and clear
- Network failures: if `/api/billing-status` fails, fall back to current behavior but prefer dashboard over pricing

### To-dos

- [ ] Create functions/api/billing-status.js using Stripe REST wrapper
- [ ] Verify-email: call billing-status before checkout; route accordingly
- [ ] Dashboard: sync plan from billing-status; clear selectedPlan on ?paid=1
- [ ] Drive plan badge/trial countdown from billing-status response
- [ ] Account settings: read and display billing-status
- [ ] Run manual flows to validate trial and verify-email UX