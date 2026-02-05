# Quick Start: Delete User Data

## Prerequisites

1. **Create API Token with Proper Permissions**
   - See `API_TOKEN_SETUP.md` for detailed instructions
   - Required permissions:
     - Account → Cloudflare D1 → Edit
     - Account → Workers KV Storage → Edit

## Usage

```bash
cd app/scripts

# Set your API token and account ID
export CLOUDFLARE_API_TOKEN="your-api-token-here"
export CLOUDFLARE_ACCOUNT_ID="fabf4409ef32f8c64354a1a099bef2a2"

# Run the deletion script
./delete-user-by-name.sh <USER_ID> [email]

# Example:
./delete-user-by-name.sh REPLACE_WITH_USER_ID test.user@example.com
```

## What Gets Deleted

### D1 Databases (DEV and QA)
- **Tables with CASCADE** (automatically deleted):
  - `resume_sessions`
  - `feedback_sessions`
  - `usage_events`
  - `interview_question_sets`
  - `mock_interview_sessions`
  - `mock_interview_usage`
  - `cookie_consents`
  - `feature_daily_usage`

- **Tables without CASCADE** (explicitly deleted):
  - `linkedin_runs`
  - `role_usage_log`
  - `cover_letter_history`
  - `plan_change_history` (if exists)

- **Users table** (deleted last, cascades to related tables)

### KV Namespace (Shared DEV/QA)
- All standard keys: `planByUid:`, `cusByUid:`, `usage:`, `user:`, etc.
- All resume keys: `resume:*` matching the user ID
- All usage tracking keys

## Database Names Used

- **DEV**: `jobhackai-dev-db`
- **QA**: `jobhackai-qa-db`
- **KV**: `5237372648c34aa6880f91e1a0c9708a` (jobhackai-kv-dev-qa-shared)

## Troubleshooting

### "Authentication error [code: 10000]"
→ Your API token doesn't have the required permissions. See `API_TOKEN_SETUP.md`

### "Rate limited"
→ Wait a few minutes and try again. The script includes rate limiting protection.

### "Database not found"
→ Verify database names in `wrangler.toml` match your Cloudflare account.
