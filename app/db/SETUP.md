# D1 Database Setup

This document describes how to set up the D1 database for JobHackAI Resume Feedback.

## Environment Model

| Branch   | Environment | D1 Database              |
|----------|-------------|--------------------------|
| dev0     | DEV         | `jobhackai-dev-db`       |
| develop  | QA          | `jobhackai-qa-db`        |
| main     | PROD        | `jobhackai-prod-db`      |

Each environment has its own D1 database. In code, we always access the D1 binding as **`env.DB`**. Cloudflare Pages will bind the correct database per environment.

---

## 1. Create D1 Databases (One-Time Setup)

Run these commands to create the databases for each environment:

```bash
# DEV database
wrangler d1 create jobhackai-dev-db

# QA database
wrangler d1 create jobhackai-qa-db

# PROD database
wrangler d1 create jobhackai-prod-db
```

Note the database IDs returned for each. You'll need them for the Pages configuration.

---

## 2. Apply Schema

Apply the schema to each database:

```bash
# DEV
wrangler d1 execute jobhackai-dev-db --file=./db/schema.sql

# QA
wrangler d1 execute jobhackai-qa-db --file=./db/schema.sql

# PROD
wrangler d1 execute jobhackai-prod-db --file=./db/schema.sql
```

For local development, apply to local D1:

```bash
wrangler d1 execute jobhackai-dev-db --file=./db/schema.sql --local
```

---

## 3. Configure Pages D1 Binding

### Option A: Cloudflare Dashboard (Recommended for Pages)

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → **jobhackai-app** (or your project name)
2. Click **Settings** → **Functions** → **D1 database bindings**
3. Add binding:
   - **Variable name**: `DB`
   - **D1 database**: Select the appropriate database for the environment
4. Click **Save**

Repeat for each environment (production, preview).

### Option B: wrangler.local.toml (Local Development)

Add the following to `app/wrangler.local.toml`:

```toml
# D1 database binding for local development
[[d1_databases]]
binding = "DB"
database_name = "jobhackai-dev-db"
database_id = "<YOUR_DEV_DATABASE_ID>"  # Get this from `wrangler d1 list`
```

Replace `<YOUR_DEV_DATABASE_ID>` with the actual database ID from step 1.

---

## 4. Verify Setup

After applying the schema, verify tables exist:

```bash
# List tables
wrangler d1 execute jobhackai-dev-db --command="SELECT name FROM sqlite_master WHERE type='table';"

# Check users table
wrangler d1 execute jobhackai-dev-db --command="PRAGMA table_info(users);"
```

---

## 5. Local Development

For local development with `wrangler pages dev`:

1. Ensure D1 binding is configured in `wrangler.local.toml` (see Option B above)
2. Run local server:
   ```bash
   wrangler pages dev ./out --d1=DB
   ```

The local D1 database is stored in `.wrangler/state/v3/d1/`.

---

## Schema Migrations

When you need to update the schema:

1. Create a migration file (e.g., `db/migrations/001_add_column.sql`)
2. Apply to all environments:
   ```bash
   wrangler d1 execute jobhackai-dev-db --file=./db/migrations/001_add_column.sql
   wrangler d1 execute jobhackai-qa-db --file=./db/migrations/001_add_column.sql
   wrangler d1 execute jobhackai-prod-db --file=./db/migrations/001_add_column.sql
   ```

---

## Tables Overview

| Table             | Purpose                                          |
|-------------------|--------------------------------------------------|
| `users`           | User records linked to Firebase auth (auth_id)   |
| `resume_sessions` | Each resume analyzed by a user                   |
| `feedback_sessions` | Feedback runs linked to resume sessions        |
| `usage_events`    | Usage logs for metering (tokens, feature usage)  |

See `schema.sql` for full table definitions and indexes.

