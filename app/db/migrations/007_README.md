# Migration 007: Add Plan Column to Users Table

## Problem
The `users` table is missing the `plan` column, causing SQL errors:
- `D1_ERROR: no such column: plan at offset 27: SQLITE_ERROR`
- Interview questions generation fails with 500 errors
- Lock icon shows incorrectly for all plans
- Usage indicators may not display correctly

## Solution
This migration adds the `plan` column and all subscription-related columns to the `users` table.

## What This Migration Does
1. Adds `plan` column (TEXT, default 'free')
2. Adds Stripe subscription columns (`stripe_customer_id`, `stripe_subscription_id`, `subscription_status`)
3. Adds trial/subscription timing columns (`trial_ends_at`, `current_period_end`, `cancel_at`)
4. Adds scheduled plan change tracking (`scheduled_plan`, `scheduled_at`)
5. Adds metadata tracking (`plan_updated_at`)
6. Creates indexes for efficient queries

## Migration Status
- ✅ **Code**: Defensive error handling added to handle missing column gracefully
- ⏳ **Dev**: Migration needs to be run
- ⏳ **QA**: Migration needs to be run
- ⏳ **Production**: Migration needs to be run

## Running the Migration

### Option 1: Cloudflare Dashboard (Recommended)
1. Go to Cloudflare Dashboard → Workers & Pages → D1
2. Select your database (dev/qa/prod)
3. Go to "SQL Editor"
4. Copy and paste the contents of `007_add_plan_to_users.sql`
5. Click "Execute"

### Option 2: Using Wrangler CLI
If you have the database configured in your `wrangler.toml`:

```bash
# For dev
wrangler d1 execute jobhackai-dev-db --file=./app/db/migrations/007_add_plan_to_users.sql

# For QA
wrangler d1 execute jobhackai-qa-db --file=./app/db/migrations/007_add_plan_to_users.sql

# For Production
wrangler d1 execute jobhackai-prod-db --file=./app/db/migrations/007_add_plan_to_users.sql
```

### Option 3: Using Migration Script
```bash
cd app/scripts
./apply-migration-007.sh
```

## Verification
After running the migration, verify the column exists:

```sql
PRAGMA table_info(users);
```

You should see the `plan` column in the output.

## Safety
- ✅ Safe to run multiple times (SQLite will error if column exists, but that's harmless)
- ✅ Existing users will get `plan = 'free'` by default
- ✅ Code has defensive error handling - will work even if migration hasn't been run yet

## Code Changes Made
1. **`app/functions/_lib/db.js`**: Added defensive error handling in `getOrCreateUserByAuthId()` to handle missing `plan` column gracefully
2. **Migration file**: Added comments explaining safety

## Impact
- ✅ Fixes SQL errors in interview questions generation
- ✅ Fixes lock icon showing incorrectly
- ✅ Enables proper plan detection from D1
- ✅ Enables usage indicators to work correctly

