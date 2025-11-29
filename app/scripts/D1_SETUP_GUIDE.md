# D1 Setup - Automated Script Guide

## Quick Start

The setup script automates everything except the final Dashboard configuration step.

### Step 1: Get Your Cloudflare Credentials

1. **API Token** (with `Pages:Edit` permission):
   - Go to: https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token"
   - Use "Edit Cloudflare Workers" template
   - Add custom permission: `Account` → `Cloudflare Pages` → `Edit`
   - Copy the token

2. **Account ID**:
   - Go to: https://dash.cloudflare.com
   - Look at the right sidebar → Your Account ID is displayed there
   - Copy it

### Step 2: Run the Setup Script

**Option A: With Environment Variables (Recommended)**

```bash
cd app

# Set credentials
export CLOUDFLARE_API_TOKEN="your-api-token-here"
export CLOUDFLARE_ACCOUNT_ID="your-account-id-here"

# Run setup
./scripts/setup-d1.sh
```

**Option B: Inline (One Command)**

```bash
cd app
CLOUDFLARE_API_TOKEN="your-token" CLOUDFLARE_ACCOUNT_ID="your-account-id" ./scripts/setup-d1.sh
```

**Option C: Interactive (Will Prompt)**

```bash
cd app
./scripts/setup-d1.sh
# Enter credentials when prompted
```

### Step 3: Configure Dashboard Bindings

After the script completes, run:

```bash
./scripts/configure-d1-bindings.sh
```

This will show you the exact steps and database IDs needed to configure bindings in the Cloudflare Dashboard.

**OR** follow the instructions printed at the end of `setup-d1.sh`.

### What the Script Does

✅ Creates 3 D1 databases (DEV, QA, PROD)  
✅ Applies schema to all databases  
✅ Applies schema to local DEV database  
✅ Updates `wrangler.local.toml` with local binding  
✅ Verifies schema was applied correctly  
✅ Provides instructions for Dashboard configuration  

### Troubleshooting

**"wrangler: command not found"**
```bash
npm install -g wrangler
wrangler login
```

**"Database already exists"**
- The script will skip creation and use the existing database

**"Schema application failed"**
- Check that `app/db/schema.sql` exists
- Verify you have permissions to create D1 databases

**"jq: command not found"**
```bash
# macOS
brew install jq

# Linux
sudo apt-get install jq
```

### Manual Steps (If Script Fails)

If the script fails, you can do it manually:

```bash
# 1. Create databases
wrangler d1 create jobhackai-dev-db
wrangler d1 create jobhackai-qa-db
wrangler d1 create jobhackai-prod-db

# 2. Apply schema
wrangler d1 execute jobhackai-dev-db --file=./db/schema.sql
wrangler d1 execute jobhackai-qa-db --file=./db/schema.sql
wrangler d1 execute jobhackai-prod-db --file=./db/schema.sql

# 3. Apply locally
wrangler d1 execute jobhackai-dev-db --file=./db/schema.sql --local

# 4. Get database IDs
wrangler d1 list
```

Then configure bindings in Dashboard (see `configure-d1-bindings.sh` output).

