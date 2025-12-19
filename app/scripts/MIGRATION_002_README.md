# Migration 002: feature_daily_usage Table

## Overview

This migration creates the `feature_daily_usage` table required for tracking Interview Questions usage counters. This table was missing in the dev database, causing the counter to stay at 0.

## What This Migration Does

Creates the `feature_daily_usage` table with:
- Tracks daily usage counts per user per feature
- Used for Interview Questions monthly counter
- Supports future features that need daily quota tracking

## Migration File

`app/db/migrations/002_add_feature_daily_usage.sql`

## Status

- ✅ **Dev**: Table auto-created by code (migration can be run manually if desired)
- ⏳ **QA**: Migration needed
- ⏳ **Production**: Migration needed

## Running the Migration

### Option 1: Using the Migration Script (Recommended)

```bash
cd app/scripts
./migrate-feature-daily-usage.sh qa      # QA only
./migrate-feature-daily-usage.sh prod    # Production only
./migrate-feature-daily-usage.sh both    # Both QA and Production
```

The script will:
- Check if table already exists (skips if present)
- Run the migration
- Verify the table was created successfully
- Show clear success/failure messages

### Option 2: Manual via Wrangler CLI

```bash
# QA Database
wrangler d1 execute jobhackai-qa-db --file=./app/db/migrations/002_add_feature_daily_usage.sql

# Production Database
wrangler d1 execute jobhackai-prod-db --file=./app/db/migrations/002_add_feature_daily_usage.sql
```

### Option 3: Via Cloudflare Dashboard

1. Go to **Workers & Pages** → **D1** → Select database (`jobhackai-qa-db` or `jobhackai-prod-db`)
2. Click **Console** tab
3. Copy the SQL from `app/db/migrations/002_add_feature_daily_usage.sql`
4. Paste and execute

## Verification

After running the migration, verify the table exists:

```bash
# Check QA
wrangler d1 execute jobhackai-qa-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name='feature_daily_usage';"

# Check Production
wrangler d1 execute jobhackai-prod-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name='feature_daily_usage';"
```

Expected result: Should return one row with `name = 'feature_daily_usage'`

## Safety Notes

- ✅ Migration uses `CREATE TABLE IF NOT EXISTS` - safe to run multiple times
- ✅ Indexes use `IF NOT EXISTS` - won't fail if already present
- ⚠️ **Production**: Script requires explicit "yes" confirmation before running, even when running with the `both` option.
- ⚠️ **Arguments**: An environment argument (`qa`, `prod`, or `both`) is required to run the script. It will no longer run by default.

## Auto-Creation Fallback

Even if the migration isn't run, the code will auto-create the table on first use (added in PR #282). However, running the migration is recommended because:
- Immediate fix (no waiting for first user)
- No overhead on first request
- Explicit and tracked

## Related Changes

- PR #282: Fix interview questions counter indicator
- Auto-creation function: `ensureFeatureDailyUsageTable()` in `app/functions/_lib/db.js`

## Rollback

If needed, the table can be dropped:

```sql
DROP TABLE IF EXISTS feature_daily_usage;
```

**Warning**: This will delete all usage tracking data. Only use if absolutely necessary.

