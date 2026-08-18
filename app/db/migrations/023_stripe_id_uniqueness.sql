-- Migration: Enforce one user per Stripe customer id / subscription id
-- Purpose: Stripe hotfix (billing integrity). Partial UNIQUE indexes so a
--          non-null Stripe id can belong to exactly one users row; NULLs
--          stay allowed for free users. Style precedent: migrations 008/010.
-- Date: 2026-08-16
--
-- ⚠️ APPLY ONLY AFTER THE BILLING DATA REPAIR HAS RUN.
-- PRECONDITION (must BOTH return zero rows, or CREATE UNIQUE INDEX fails —
-- also exposed as {"mode":"verify"} on /api/admin/billing-repair):
--   SELECT stripe_customer_id, COUNT(*) c FROM users
--     WHERE stripe_customer_id IS NOT NULL GROUP BY 1 HAVING c > 1;
--   SELECT stripe_subscription_id, COUNT(*) c FROM users
--     WHERE stripe_subscription_id IS NOT NULL GROUP BY 1 HAVING c > 1;
--
-- BACKWARD COMPATIBLE: older application code keeps running; a write that
-- would attach an id to a second user now fails, which updateUserPlan
-- reports as a distinct unique-conflict log and returns false (no write).
--
-- Apply (per environment, after that environment's cleanup):
--   npx wrangler d1 execute jobhackai-dev-db  --remote --file=app/db/migrations/023_stripe_id_uniqueness.sql
--   npx wrangler d1 execute jobhackai-qa-db   --remote --file=app/db/migrations/023_stripe_id_uniqueness.sql
--   npx wrangler d1 execute jobhackai-prod-db --remote --file=app/db/migrations/023_stripe_id_uniqueness.sql

-- Replace the plain index from migration 007 with the unique variant
-- (the unique index serves the same lookups).
DROP INDEX IF EXISTS idx_users_stripe_customer_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer_id_unique
  ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_subscription_id_unique
  ON users(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Rollback:
--   DROP INDEX IF EXISTS idx_users_stripe_customer_id_unique;
--   DROP INDEX IF EXISTS idx_users_stripe_subscription_id_unique;
--   CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
