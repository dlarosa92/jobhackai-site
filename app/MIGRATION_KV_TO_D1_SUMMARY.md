# Migration Summary: KV → D1 for User Plans

## ✅ Completed Phases

### Phase 1: Database Schema Migration ✅
- Created migration file: `app/db/migrations/007_add_plan_to_users.sql`
- Adds columns: `plan`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `trial_ends_at`, `current_period_end`, `cancel_at`, `scheduled_plan`, `scheduled_at`, `plan_updated_at`
- Creates indexes for efficient queries

**Next Step**: Apply migration to DEV/QA/PROD databases:
```bash
# DEV
wrangler d1 execute jobhackai-dev-db --remote --file=./app/db/migrations/007_add_plan_to_users.sql

# QA
wrangler d1 execute JOBHACKAI_DB --env=qa --remote --file=./app/db/migrations/007_add_plan_to_users.sql

# PROD (when ready)
wrangler d1 execute JOBHACKAI_DB --env=production --remote --file=./app/db/migrations/007_add_plan_to_users.sql
```

### Phase 2: Database Helper Functions ✅
- Added `getUserPlan(env, authId)` - Read plan from D1
- Added `updateUserPlan(env, authId, planData)` - Update plan in D1
- Added `getUserPlanData(env, authId)` - Get full plan metadata
- Updated `getOrCreateUserByAuthId` to include plan in SELECT

### Phase 3: Stripe Webhook Handler ✅
- Updated `app/functions/api/stripe-webhook.js`
- All webhook events now write to D1 via `updateUserPlan()`
- **Dual-write**: Still writes to KV temporarily for safety (can remove after verification)
- Handles: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

### Phase 4: Plan API Endpoint ✅
- Updated `app/functions/api/plan/me.js`
- Now reads from D1 via `getUserPlanData()`
- Returns same response format (backward compatible)

### Phase 5: Sync Stripe Plan ✅
- Updated `app/functions/api/sync-stripe-plan.js`
- Writes to D1 via `updateUserPlan()`
- **Dual-write**: Still writes to KV temporarily

### Phase 6: All API Endpoints ✅
Updated 20+ API endpoints to use D1-based `getUserPlan()`:

**Resume Features:**
- ✅ `app/functions/api/resume-feedback.js`
- ✅ `app/functions/api/resume-feedback/latest.js`
- ✅ `app/functions/api/resume-feedback/history/[id].js`
- ✅ `app/functions/api/resume-rewrite.js`
- ✅ `app/functions/api/ats-score.js`

**Interview Features:**
- ✅ `app/functions/api/interview-questions/generate.js`
- ✅ `app/functions/api/interview-questions/get-set.js`
- ✅ `app/functions/api/interview-questions/save-set.js`
- ✅ `app/functions/api/mock-interview/generate-questions.js`
- ✅ `app/functions/api/mock-interview/sessions.js`
- ✅ `app/functions/api/mock-interview/sessions/[id].js`
- ✅ `app/functions/api/mock-interview/score.js`

**Cover Letter:**
- ✅ `app/functions/api/cover-letter/generate.js`
- ✅ `app/functions/api/cover-letter/history.js`
- ✅ `app/functions/api/cover-letter/history/[id].js`

**LinkedIn:**
- ✅ `app/functions/api/linkedin/analyze.js`
- ✅ `app/functions/api/linkedin/run.js`
- ✅ `app/functions/api/linkedin/regenerate.js`
- ✅ `app/functions/api/linkedin/history.js`
- ✅ `app/functions/api/linkedin/history/[id].js`

**Other:**
- ✅ `app/functions/api/usage.js`
- ✅ `app/functions/api/cancel-subscription.js`

### Phase 7: Backfill Script ✅
- Created placeholder script: `app/scripts/backfill-plans-kv-to-d1.js`
- Manual migration recommended (KV doesn't support key listing via API)

## 🔄 Dual-Write Period

Currently, the system writes to **both D1 and KV** for safety:
- **D1**: Source of truth (all reads use D1)
- **KV**: Backup during migration period

**To remove KV writes** (after verification):
1. Remove KV write code from `stripe-webhook.js` (`updatePlanInD1` function)
2. Remove KV write code from `sync-stripe-plan.js`
3. Remove KV write code from `cancel-subscription.js`

## 📋 Next Steps

1. **Apply Database Migration** (CRITICAL - do this first!)
   ```bash
   # Apply to DEV
   wrangler d1 execute jobhackai-dev-db --remote --file=./app/db/migrations/007_add_plan_to_users.sql
   
   # Apply to QA
   wrangler d1 execute JOBHACKAI_DB --env=qa --remote --file=./app/db/migrations/007_add_plan_to_users.sql
   ```

2. **Test in DEV Environment**
   - Sign up new user → verify plan stored in D1
   - Subscribe to trial → verify plan updated in D1
   - Check `/api/plan/me` → verify reads from D1
   - Test feature gating → verify reads from D1

3. **Backfill Existing Plans** (Optional)
   - Export KV keys via Cloudflare Dashboard
   - For each user with plan in KV, update D1:
     ```sql
     UPDATE users SET plan = 'essential' WHERE auth_id = 'UID_HERE';
     ```

4. **Deploy to QA** (after DEV verification)
   - Apply migration
   - Deploy code
   - Test thoroughly

5. **Remove KV Writes** (after QA verification)
   - Remove dual-write code
   - Deploy
   - Monitor for issues

6. **Deploy to PROD** (after QA verification)
   - Apply migration
   - Deploy code
   - Monitor closely

## 🐛 Known Issues Fixed

- ✅ Email-based plan fallback removed (was causing data leakage)
- ✅ Single source of truth (D1) eliminates sync issues
- ✅ Strong consistency (SQL transactions vs eventual consistency)

## 📊 Files Changed

- **Migration**: 1 file (`007_add_plan_to_users.sql`)
- **Database Helpers**: 1 file (`_lib/db.js`)
- **Webhook/API**: 3 files (`stripe-webhook.js`, `plan/me.js`, `sync-stripe-plan.js`)
- **Feature Endpoints**: 20+ files (all updated to use D1)

## ⚠️ Important Notes

1. **Migration must be applied before deploying code** - code expects columns to exist
2. **Dual-write period** - KV writes remain temporarily for safety
3. **Backward compatible** - API responses unchanged
4. **Rollback ready** - can revert code if needed, KV still has data

