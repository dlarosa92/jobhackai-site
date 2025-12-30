# Migration 009: Role Templates

This migration creates tables for hybrid role template lifecycle management.

## Tables Created

1. **role_templates** - Stores role skill templates (must_have, nice_to_have, tools)
2. **role_usage_log** - Telemetry for role usage and keyword scores (gap detection)
3. **role_template_audit** - Optional audit trail for template changes

## Manual Migration Steps

If automated migration fails, run manually:

```bash
# Set your Cloudflare API token
export CLOUDFLARE_API_TOKEN=your-token

# Apply to DEV
wrangler d1 execute jobhackai-dev-db --file=./app/db/migrations/009_role_templates.sql --remote

# Apply to QA
wrangler d1 execute jobhackai-qa-db --file=./app/db/migrations/009_role_templates.sql --remote

# Apply to PROD
wrangler d1 execute jobhackai-prod-db --file=./app/db/migrations/009_role_templates.sql --remote
```

Or use the migration script:

```bash
CLOUDFLARE_API_TOKEN=your-token ./app/scripts/apply-role-template-migrations.sh
```

## Database IDs

- **DEV**: `c5c0eee5-a223-4ea2-974e-f4aee5a28bab`
- **QA**: `80d87a73-6615-4823-b7a4-19a8821b4f87`
- **PROD**: `f9b709fd-56c3-4a0b-8141-4542327c9d4d`

## After Migration

1. Run bootstrap script to seed existing templates:
   ```bash
   ADMIN_API_KEY=your-key ADMIN_API_URL=https://dev.jobhackai.io node app/scripts/bootstrap-role-templates.js
   ```

2. Verify tables exist:
   ```bash
   wrangler d1 execute jobhackai-dev-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'role%';" --remote
   ```

