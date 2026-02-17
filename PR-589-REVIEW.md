# PR #589 Final Review: GDPR Compliance & User Data Controls

**Reviewer:** Claude Code
**Date:** 2026-02-17
**Files Reviewed:** 22 (2,027 additions, 210 deletions)

## Overall Assessment

This PR implements GDPR-compliant data export, account deletion, inactive account cleanup, and retention enforcement. The code is defensive, handles edge cases carefully, and has solid safeguards against accidental paid-user deletion. Architecture is sound: Firebase Auth deletion is the point-of-no-return, tombstones prevent Stripe webhook resurrection of deleted users, and Stripe is treated as source of truth for subscription status.

**Verdict: Ready to merge** — provided the deployment configuration steps below are completed.

---

## CATEGORY 1: Code Issues Found

### 1.1 CORS: Production origin not in fallback list (Medium)

**Files:** `app/functions/api/user/delete.js:322-325`, `app/functions/api/user/export.js:160-163`

Both endpoints hardcode fallback origins as `['https://dev.jobhackai.io', 'https://qa.jobhackai.io']`. The production origin is missing. If `FRONTEND_URL` env var is not set in production, these API calls will fail with CORS errors.

**Recommendation:** Add production origin to fallback list, or ensure `FRONTEND_URL` is always set.

### 1.2 Migration 017 comment vs actual TTL (Low)

`017_add_deleted_auth_ids.sql` comment says "30-day retention" but actual purge in `inactive-account-cleaner/src/index.js:53` is 90 days. KV tombstone TTL (`delete.js:295`) is also 90 days. Comment is misleading.

### 1.3 No rate limiting on delete endpoint (Low)

No rate limiting on `/api/user/delete`. Practical risk is low since the token becomes invalid after the first successful deletion (Firebase Auth is deleted).

---

## CATEGORY 2: Frontend / UX Verification

### Account Settings (account-setting.html)
- [x] Download My Data button — shows loading state, triggers browser download, handles errors
- [x] Delete Account button — modal confirmation, clear language, disables during processing
- [x] Privacy & Data section — clean layout with all controls
- [x] Warning surfacing — partial cleanup failures shown to user before redirect
- [x] Post-deletion — clears localStorage, redirects to index.html

### Privacy Policy (privacy.html)
- [x] 90-day tool history retention — matches `RETENTION_DAYS = 90`
- [x] 24-month inactive account cleanup — matches worker SQL queries
- [x] Data export and deletion instructions reference Account Settings
- [x] Billing/tax/security exceptions documented
- [ ] Effective date (December 16, 2025) may need updating

---

## CATEGORY 3: Backend Verification

### Delete endpoint flow (Verified Correct)
1. Auth → 2. Resolve Stripe customer (3-tier fallback) → 3. Delete Firebase Auth FIRST → 4. Cancel Stripe subs → 5. Delete D1 tables in FK order → 6. Delete user record → 7. Send email → 8. Clean KV → 9. Write tombstones → 10. Return 200

### Export endpoint (Verified Correct)
- Queries 12 tables in parallel
- Graceful handling of missing tables/columns
- JSON download with Content-Disposition header

### Webhook tombstone protection (Verified Correct)
- All subscription event handlers check D1 + KV tombstones
- `updateUserPlan` does NOT auto-create users
- Prevents deleted account resurrection

### Table deletion parity
- `delete.js` and `inactive-account-cleaner` use same table list and ordering
- FK dependencies handled correctly (feedback_sessions before resume_sessions)
- Auth_id vs userId column type correctly distinguished

---

## CATEGORY 4: Deployment Checklist (MUST DO)

### 4.1 Database Migrations

Run on ALL environments (dev, qa, production):

```bash
wrangler d1 execute <DB_ID> --file=app/db/migrations/015_add_activity_tracking.sql --env <env>
wrangler d1 execute <DB_ID> --file=app/db/migrations/016_add_updated_at_to_resume_sessions.sql --env <env>
wrangler d1 execute <DB_ID> --file=app/db/migrations/017_add_deleted_auth_ids.sql --env <env>
```

DB IDs: Dev=`c5c0eee5-a223-4ea2-974e-f4aee5a28bab`, QA=`80d87a73-6615-4823-b7a4-19a8821b4f87`, Prod=`f9b709fd-56c3-4a0b-8141-4542327c9d4d`

### 4.2 Worker Secrets — Main Site

```bash
wrangler secret put RESEND_API_KEY --env <env>
wrangler secret put FIREBASE_WEB_API_KEY --env <env>
```

### 4.3 Worker Secrets — Inactive Account Cleaner

```bash
cd workers/inactive-account-cleaner
wrangler secret put RESEND_API_KEY --env <env>
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --env <env>
wrangler secret put STRIPE_SECRET_KEY --env <env>
```

NOTE: Uses FIREBASE_SERVICE_ACCOUNT_JSON (service account for server-side deletion), NOT FIREBASE_WEB_API_KEY.

### 4.4 Environment Variables

```bash
# CRITICAL for production CORS
wrangler secret put FRONTEND_URL --env production
# Value: https://app.jobhackai.io (or your production domain)
```

### 4.5 Stripe Price IDs on Inactive Account Cleaner

Verify these are set on the worker for each environment:
- `STRIPE_PRICE_ESSENTIAL_MONTHLY` (or `PRICE_ESSENTIAL_MONTHLY`)
- `STRIPE_PRICE_PRO_MONTHLY` (or `PRICE_PRO_MONTHLY`)
- `STRIPE_PRICE_PREMIUM_MONTHLY` (or `PRICE_PREMIUM_MONTHLY`)

### 4.6 Deploy Workers

```bash
cd workers/inactive-account-cleaner && wrangler deploy --env <env>
cd workers/retention-cleaner && wrangler deploy --env <env>
```

### 4.7 Resend Configuration

- Verify `jobhackai.io` domain is verified in Resend
- Verify SPF/DKIM records are configured
- Sending from: `noreply@jobhackai.io`

### 4.8 Firebase Service Account

Generate from Firebase Console > Project Settings > Service Accounts. Needs `Firebase Authentication Admin` role. JSON must include `client_email`, `private_key`, `project_id`.

---

## CATEGORY 5: Non-Blocking Recommendations

1. Update migration 017 comment from "30-day" to "90-day" retention
2. Add production origins to CORS fallback lists as safety net
3. Update privacy policy effective date to actual deployment date
4. Consider adding `?deleted=1` query param to post-deletion redirect for a brief confirmation message
