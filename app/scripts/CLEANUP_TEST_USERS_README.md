# Cleanup Test Users - Instructions

This document explains how to clear KV and D1 data for test email addresses.

## Test Email Addresses
- jobshackai@gmail.com
- dlarosa92@gmail.com
- sebastian.larosa@jobhackai.io

## Prerequisites

1. **Cloudflare API Token** with permissions:
   - Account: Read
   - Workers KV Storage: Edit
   - D1: Edit
   
   Create at: https://dash.cloudflare.com/profile/api-tokens

2. **Cloudflare Account ID**
   - Get from: `wrangler whoami` or Cloudflare Dashboard

3. **KV Namespace IDs** (for DEV and QA)
   - Get from Cloudflare Dashboard → Workers & Pages → KV
   - Or use the auto-detection in the script

## Method 1: Automated Script (Recommended)

### Setup
```bash
cd app/scripts
export CLOUDFLARE_API_TOKEN="your_api_token_here"
export CLOUDFLARE_ACCOUNT_ID="your_account_id_here"
# Optional: Set KV namespace IDs if auto-detection fails
export KV_NAMESPACE_ID_DEV="your_dev_kv_namespace_id"
export KV_NAMESPACE_ID_QA="your_qa_kv_namespace_id"
```

### Run
```bash
./cleanup-test-users.sh
```

The script will:
1. Auto-detect D1 database IDs (dev and qa)
2. Auto-detect KV namespace IDs (if not provided)
3. Query D1 for users by email to get Firebase UIDs
4. Delete all KV keys for those UIDs (both dev and qa)
5. Delete D1 user records (cascade deletes related records)

## Method 2: Manual D1 Cleanup

### Get Database IDs
```bash
wrangler d1 list
```

### Delete Users by Email (for each database)

**DEV Database:**
```bash
wrangler d1 execute <DEV_DB_ID> \
  --command="DELETE FROM users WHERE email = 'jobshackai@gmail.com';"
wrangler d1 execute <DEV_DB_ID> \
  --command="DELETE FROM users WHERE email = 'dlarosa92@gmail.com';"
wrangler d1 execute <DEV_DB_ID> \
  --command="DELETE FROM users WHERE email = 'sebastian.larosa@jobhackai.io';"
```

**QA Database:**
```bash
wrangler d1 execute <QA_DB_ID> \
  --command="DELETE FROM users WHERE email = 'jobshackai@gmail.com';"
wrangler d1 execute <QA_DB_ID> \
  --command="DELETE FROM users WHERE email = 'dlarosa92@gmail.com';"
wrangler d1 execute <QA_DB_ID> \
  --command="DELETE FROM users WHERE email = 'sebastian.larosa@jobhackai.io';"
```

**Note:** Deleting from `users` table will cascade delete related records in:
- `resume_sessions`
- `feedback_sessions`
- `usage_events`
- `interview_question_sets`

## Method 3: Manual KV Cleanup

### Get Firebase UIDs from D1
First, query D1 to get the Firebase UIDs (auth_id) for each email:

```bash
# For each email, get the auth_id
wrangler d1 execute <DB_ID> \
  --command="SELECT auth_id FROM users WHERE email = 'jobshackai@gmail.com';"
```

### Delete KV Keys by UID

Use the `delete-keys-by-uid.sh` script:

```bash
cd app/scripts
export CLOUDFLARE_API_TOKEN="your_api_token"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
export KV_NAMESPACE_ID="your_kv_namespace_id"

./delete-keys-by-uid.sh <uid1> <uid2> <uid3>
```

Or manually delete keys using Cloudflare API:

```bash
# For each UID, delete all related keys
curl -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/planByUid:${UID}" \
  -H "Authorization: Bearer ${API_TOKEN}"

# Repeat for all key patterns:
# - planByUid:${UID}
# - cusByUid:${UID}
# - trialEndByUid:${UID}
# - usage:${UID}
# - user:${UID}
# - session:${UID}
# - resume:${UID}:*
# - etc.
```

## Key Patterns to Delete

For each UID, delete these KV keys:
- `planByUid:${UID}`
- `cusByUid:${UID}`
- `trialEndByUid:${UID}`
- `cancelAtByUid:${UID}`
- `periodEndByUid:${UID}`
- `scheduledPlanByUid:${UID}`
- `scheduledAtByUid:${UID}`
- `planTsByUid:${UID}`
- `trialUsedByUid:${UID}`
- `usage:${UID}`
- `user:${UID}`
- `session:${UID}`
- `creditsByUid:${UID}`
- `atsUsage:${UID}`
- `feedbackUsage:${UID}`
- `rewriteUsage:${UID}`
- `mockInterviewUsage:${UID}`
- `throttle:${UID}`
- `user:${UID}:lastResume`
- `iq_cooldown:${UID}`
- `iq_lock:${UID}`
- `resume:${UID}:*` (all resume keys for this UID)

## Verification

After cleanup, verify:

1. **D1:**
   ```bash
   wrangler d1 execute <DB_ID> \
     --command="SELECT * FROM users WHERE email IN ('jobshackai@gmail.com', 'dlarosa92@gmail.com', 'sebastian.larosa@jobhackai.io');"
   ```
   Should return no rows.

2. **KV:**
   ```bash
   # List all keys and check for UIDs
   curl -X GET \
     "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys" \
     -H "Authorization: Bearer ${API_TOKEN}"
   ```
   Should not contain keys with the test UIDs.

## Troubleshooting

### Script fails with "Couldn't find a D1 DB"
- Ensure you're using database IDs (UUIDs) not names
- Run `wrangler d1 list` to get the correct IDs
- Update the script or use manual method

### KV namespace not found
- Check Cloudflare Dashboard → Workers & Pages → KV
- Ensure you have the correct namespace IDs for dev and qa
- Set `KV_NAMESPACE_ID_DEV` and `KV_NAMESPACE_ID_QA` environment variables

### No users found in D1
- Users may not exist in D1 yet (only created on first API call)
- This is normal - just means there's no D1 data to clean
- Still need to clean KV data if it exists










