-- Migration: Add has_ever_paid column for trial eligibility enforcement
-- Purpose: Track if user has ever had a paid subscription (prevents trial abuse)
-- Date: 2025-01-XX
--
-- This migration adds a column to track whether a user has ever had a paid
-- subscription. This is used to enforce the business rule that trials are
-- only available to first-time subscribers.
--
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS checks where possible
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, but
-- attempting to add an existing column will fail gracefully with a clear error.

-- Add has_ever_paid column (0 = false, 1 = true)
-- Note: SQLite will error if column exists, but that's safe - just means migration already ran
ALTER TABLE users ADD COLUMN has_ever_paid INTEGER DEFAULT 0;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_users_has_ever_paid ON users(has_ever_paid);

-- Backfill: Set has_ever_paid = 1 for existing paid users
UPDATE users SET has_ever_paid = 1 WHERE plan IN ('essential', 'pro', 'premium');

-- Also backfill users who previously had a paid subscription according to plan_change_history.
-- This covers users who cancelled (now 'free') but previously were on a paid plan.
UPDATE users SET has_ever_paid = 1
WHERE id IN (
  SELECT DISTINCT pch.user_id
  FROM plan_change_history pch
  WHERE pch.to_plan IN ('essential', 'pro', 'premium')
     OR pch.from_plan IN ('essential', 'pro', 'premium')
);

