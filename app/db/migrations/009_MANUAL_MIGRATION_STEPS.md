# Manual Migration Steps for 009_role_templates

## Issue
Automated migration via wrangler CLI failed due to API token permissions. The token needs D1 write access.

## Option 1: Fix API Token Permissions

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Edit your API token or create a new one with:
   - **Account** → **Cloudflare D1** → **Edit** permissions
   - **Zone** → **Zone Settings** → **Read** (if needed)
3. Retry the migration script:
   ```bash
   CLOUDFLARE_API_TOKEN=your-token ./app/scripts/apply-role-template-migrations.sh
   ```

## Option 2: Manual Migration via Cloudflare Dashboard

### For each environment (DEV, QA, PROD):

1. Go to Cloudflare Dashboard → D1 → Select database
2. Click "Console" tab
3. Copy and paste the SQL from `009_role_templates.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS role_templates (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     role_family TEXT UNIQUE NOT NULL,
     must_have_json TEXT NOT NULL,
     nice_to_have_json TEXT NOT NULL,
     tools_json TEXT NOT NULL,
     status TEXT DEFAULT 'active',
     version INTEGER DEFAULT 1,
     created_by TEXT,
     created_at TEXT DEFAULT (datetime('now')),
     updated_at TEXT DEFAULT (datetime('now')),
     approved_by TEXT,
     approved_at TEXT
   );
   
   CREATE INDEX IF NOT EXISTS idx_role_templates_family ON role_templates(role_family);
   CREATE INDEX IF NOT EXISTS idx_role_templates_status ON role_templates(status);
   
   CREATE TABLE IF NOT EXISTS role_usage_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL,
     role_label TEXT NOT NULL,
     role_family TEXT NOT NULL,
     keyword_score INTEGER,
     created_at TEXT DEFAULT (datetime('now'))
   );
   
   CREATE INDEX IF NOT EXISTS idx_role_usage_log_family ON role_usage_log(role_family);
   CREATE INDEX IF NOT EXISTS idx_role_usage_log_created_at ON role_usage_log(created_at DESC);
   
   CREATE TABLE IF NOT EXISTS role_template_audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     role_family TEXT NOT NULL,
     action TEXT NOT NULL,
     old_data_json TEXT,
     new_data_json TEXT,
     changed_by TEXT NOT NULL,
     changed_at TEXT DEFAULT (datetime('now'))
   );
   
   CREATE INDEX IF NOT EXISTS idx_role_template_audit_family ON role_template_audit(role_family);
   CREATE INDEX IF NOT EXISTS idx_role_template_audit_changed_at ON role_template_audit(changed_at DESC);
   ```
4. Click "Run" to execute

### Database IDs:
- **DEV**: `c5c0eee5-a223-4ea2-974e-f4aee5a28bab` → https://dash.cloudflare.com/[account]/d1/databases/c5c0eee5-a223-4ea2-974e-f4aee5a28bab
- **QA**: `80d87a73-6615-4823-b7a4-19a8821b4f87` → https://dash.cloudflare.com/[account]/d1/databases/80d87a73-6615-4823-b7a4-19a8821b4f87
- **PROD**: `f9b709fd-56c3-4a0b-8141-4542327c9d4d` → https://dash.cloudflare.com/[account]/d1/databases/f9b709fd-56c3-4a0b-8141-4542327c9d4d

## Option 3: Use Wrangler with OAuth (if you're logged in)

If you're already logged into wrangler via OAuth:
```bash
wrangler d1 execute jobhackai-dev-db --file=./app/db/migrations/009_role_templates.sql --remote
wrangler d1 execute jobhackai-qa-db --file=./app/db/migrations/009_role_templates.sql --remote
wrangler d1 execute jobhackai-prod-db --file=./app/db/migrations/009_role_templates.sql --remote
```

## Verification

After migration, verify tables exist:
```bash
wrangler d1 execute jobhackai-dev-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'role%';" --remote
```

Expected output should show:
- `role_templates`
- `role_usage_log`
- `role_template_audit`

