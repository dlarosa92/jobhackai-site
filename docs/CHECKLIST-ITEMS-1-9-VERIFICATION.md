# Checklist Items 1–9: Step-by-Step Verification Guide

Use this guide with screenshots to confirm each step. **Recommended order:** 1 → 2 → 4 → 3 → 6 → 7 → 8 → 9 (fill placeholders + redeploy) → 5 (when ready for live).

---

## Item 1 — Merge SPF Records (you are here)

**Where:** Cloudflare Dashboard → your domain (jobhackai.io) → **DNS** → **Records**

**What to do:**
1. Find the **two** root (`@`) TXT records that start with `v=spf1`.
2. **Delete both:** three-dot menu (⋮) → **Delete** for each.
3. **Add one merged record:**
   - **Type:** TXT  
   - **Name:** `@`  
   - **Content:**  
     `v=spf1 include:_spf.google.com include:_spf.firebasemail.com include:spf.mtasv.net include:resend.com ~all`  
   - **TTL:** Auto  
4. **Save.**

**Screenshot check:** You should see **exactly one** root TXT record with that full `v=spf1 ... ~all` value. No other root SPF TXT records.

---

## Item 2 — Verify Resend DKIM

**Where:** [resend.com](https://resend.com) → **Domains** → click **jobhackai.io**

**What to check:**
- All records show **Verified** (green).
- If **resend._domainkey** is **Pending**, wait a few minutes and refresh (TTL).
- If **Failed**, open the record in Resend and compare the expected value to the `resend._domainkey` TXT in Cloudflare DNS.

**Screenshot check:** Domains page for jobhackai.io with all DKIM/SPF (if shown) statuses green/Verified. No DNS changes needed if already verified.

---

## Item 3 — Fix STRIPE_PORTAL_CONFIGURATION_ID (Production)

**Step A — Get the ID from Stripe**
1. [Stripe Dashboard](https://dashboard.stripe.com) → switch to **Live** mode (top-left).
2. **Settings** → **Billing** → **Customer portal**.
3. In the browser URL you’ll see:  
   `.../portal-configurations/bpc_XXXXXXXX`  
   Copy the **bpc_XXXXXXXX** value.

**Step B — Set it in Cloudflare**
1. Cloudflare Dashboard → **Workers & Pages** → **jobhackai-site** (prod) → **Settings** → **Variables**.
2. Find **STRIPE_PORTAL_CONFIGURATION_ID** → **Edit**.
3. Paste **bpc_XXXXXXXX** → **Save**.

**Screenshot check:** Stripe URL showing `bpc_...`, and Cloudflare variable value matching that ID (value is masked but length/prefix should be consistent).

---

## Item 4 — Redeploy Dev Pages Project

**Why:** So the dev project picks up **RESEND_API_KEY** (and any other new secrets).

**Option A — Terminal (from repo root)**  
```bash
cd app && npm run build && cd .. && wrangler pages deploy app/out --project-name=jobhackai-site-dev
```  
If your pipeline deploys from Git, use **Option B** instead.

**Option B — Cloudflare Dashboard**
1. **Workers & Pages** → **jobhackai-site-dev** → **Deployments**.
2. Open the latest deployment → **Retry deployment**.
3. Wait until it completes.

**Screenshot check:** Latest deployment for jobhackai-site-dev shows a new successful run after the retry/redeploy.

---

## Item 5 — Swap Stripe Test Keys to Live Keys

**When:** Only when you’re ready to go live.

**Stripe:** Dashboard → **Live** mode → **Developers** → **API keys** → copy **pk_live_...** and **sk_live_...**.

**Cloudflare:** For each environment (dev/qa/prod as you use them):
- **Workers & Pages** → project → **Settings** → **Variables**
- **STRIPE_PUBLISHABLE_KEY** → `pk_live_...`
- **STRIPE_SECRET_KEY** → `sk_live_...`
- **Redeploy** that project so new keys are used.

**Screenshot check:** Variables show live key names (values will be masked). After deploy, billing/checkout should use Live mode.

---

## Item 6 — Run DB Migrations 015, 016, 017

**Where:** Terminal, from **repo root** (`jobhackai-site/`).

**If your project uses `wrangler d1 migrations apply`** (and wrangler is configured with a migrations path for JOBHACKAI_DB):

```bash
# DEV
wrangler d1 migrations apply JOBHACKAI_DB --env dev

# QA
wrangler d1 migrations apply JOBHACKAI_DB --env qa

# Production
wrangler d1 migrations apply JOBHACKAI_DB --env production
```

Confirm when prompted; only pending migrations will run.

**If that command fails** (e.g. “migrations” or “database” not found), apply the three migration files manually. From **repo root**:

```bash
# DEV
wrangler d1 execute jobhackai-dev-db --remote --file=./app/db/migrations/015_add_activity_tracking.sql
wrangler d1 execute jobhackai-dev-db --remote --file=./app/db/migrations/016_add_updated_at_to_resume_sessions.sql
wrangler d1 execute jobhackai-dev-db --remote --file=./app/db/migrations/017_add_deleted_auth_ids.sql

# QA (use your QA database name if different)
wrangler d1 execute jobhackai-qa-db --remote --file=./app/db/migrations/015_add_activity_tracking.sql
wrangler d1 execute jobhackai-qa-db --remote --file=./app/db/migrations/016_add_updated_at_to_resume_sessions.sql
wrangler d1 execute jobhackai-qa-db --remote --file=./app/db/migrations/017_add_deleted_auth_ids.sql

# Production
wrangler d1 execute jobhackai-prod-db --remote --file=./app/db/migrations/015_add_activity_tracking.sql
wrangler d1 execute jobhackai-prod-db --remote --file=./app/db/migrations/016_add_updated_at_to_resume_sessions.sql
wrangler d1 execute jobhackai-prod-db --remote --file=./app/db/migrations/017_add_deleted_auth_ids.sql
```

**Migrations summary:**
- **015** — Adds `last_login_at`, `last_activity_at`, `deletion_warning_sent_at` to `users`.
- **016** — Adds `updated_at` to `resume_sessions` and backfills it.
- **017** — Creates `deleted_auth_ids` table (tombstone for deleted users).

**Screenshot check:** Terminal output showing “Success” or no errors for each execute/apply. Run **before** deploying the cron workers (Item 7).

---

## Item 7 — Deploy the Standalone Workers

**Where:** Terminal. Run from **each worker directory** in turn.

**Retention cleaner (daily 90-day tool history purge):**
```bash
cd workers/retention-cleaner
wrangler deploy --env dev
wrangler deploy --env qa
wrangler deploy --env production
cd ../..
```

**Inactive account cleaner (monthly 24-month inactivity purge):**
```bash
cd workers/inactive-account-cleaner
wrangler deploy --env dev
wrangler deploy --env qa
wrangler deploy --env production
cd ../..
```

**Screenshot check:** Each `wrangler deploy` ends with a success line and URL. In Cloudflare Dashboard → **Workers** → each worker name → **Triggers**, confirm the cron schedule is listed (e.g. daily 03:00 UTC for retention-cleaner, monthly 1st at 04:00 UTC for inactive-account-cleaner).

---

## Item 8 — Set Secrets on Standalone Workers

**Retention cleaner:** No secrets; D1/KV bindings in wrangler.toml are enough. Skip.

**Inactive account cleaner:** Set these **per environment** after deploying (Item 7).

```bash
cd workers/inactive-account-cleaner

# Dev
wrangler secret put RESEND_API_KEY --env dev
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --env dev
wrangler secret put STRIPE_SECRET_KEY --env dev

# QA
wrangler secret put RESEND_API_KEY --env qa
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --env qa
wrangler secret put STRIPE_SECRET_KEY --env qa

# Production
wrangler secret put RESEND_API_KEY --env production
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --env production
wrangler secret put STRIPE_SECRET_KEY --env production
```

When prompted:
- **RESEND_API_KEY** — paste the Resend API key.
- **STRIPE_SECRET_KEY** — paste `sk_test_...` or `sk_live_...` for that env.
- **FIREBASE_SERVICE_ACCOUNT_JSON** — paste the **entire** service account JSON (one line is fine).

**Screenshot check:** Each `wrangler secret put` completes without error. You can confirm in Dashboard → Workers → **inactive-account-cleaner** → **Settings** → **Variables and Secrets** that the secret names exist (values are hidden).

---

## Item 9 — Stripe Price IDs in inactive-account-cleaner

**Status:** Placeholders are in `workers/inactive-account-cleaner/wrangler.toml` for:
- `STRIPE_PRICE_ESSENTIAL_MONTHLY`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PREMIUM_MONTHLY`

**What you need to do:**
1. Stripe Dashboard → **Products** → open **Essential**, **Pro**, **Premium**.
2. For each product, copy the **Price ID** (e.g. `price_1ABC...`) for the **monthly** recurring price.
3. In `workers/inactive-account-cleaner/wrangler.toml`, replace:
   - `price_REPLACE_ESSENTIAL` → your Essential monthly price ID  
   - `price_REPLACE_PRO` → your Pro monthly price ID  
   - `price_REPLACE_PREMIUM` → your Premium monthly price ID  
   in **all three** envs: `[env.dev]`, `[env.qa]`, `[env.production]`.
4. **Redeploy** the inactive-account-cleaner worker for each environment so the new vars are used.

**Screenshot check:** Stripe product pages showing the correct monthly price IDs; wrangler.toml (or a quick grep) showing no remaining `price_REPLACE_` strings.

---

## Summary Table

| # | Item | Where | Done |
|---|------|--------|------|
| 1 | Merge SPF + add Resend | Cloudflare DNS | ☐ |
| 2 | Verify Resend DKIM | Resend Dashboard | ☐ |
| 3 | Fix STRIPE_PORTAL_CONFIGURATION_ID | Cloudflare prod vars | ☐ |
| 4 | Redeploy dev Pages | Dashboard or wrangler | ☐ |
| 5 | Swap test → live Stripe keys | Stripe + Cloudflare | ☐ (when going live) |
| 6 | Run migrations 015, 016, 017 | Terminal | ☑ |
| 7 | Deploy both cron workers | Terminal | ☑ |
| 8 | Set secrets on inactive-account-cleaner | Terminal / Dashboard | ☑ |
| 9 | Replace Stripe price IDs + redeploy | wrangler.toml / Dashboard | ☑ |
