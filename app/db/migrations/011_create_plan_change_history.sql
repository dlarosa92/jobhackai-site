-- Migration: Create plan_change_history table for analytics
-- Purpose: Track plan changes for business intelligence and debugging
-- Retention: 90 days per privacy policy (can be extended for billing reconciliation)
-- Date: 2025-01-XX
--
-- This migration creates a table to track all plan changes (upgrades, downgrades,
-- reactivations, cancellations) for analytics purposes. This data helps with:
-- - Conversion rate analysis
-- - Upgrade/downgrade pattern analysis
-- - Reactivation rate tracking
-- - Billing issue debugging
--
-- Privacy Note: This table stores plan names and change types, not PII.
-- Records can be cleaned up after 90 days or kept longer for billing reconciliation.
--
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS checks

CREATE TABLE IF NOT EXISTS plan_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_plan TEXT,                    -- Previous plan (nullable for new subscriptions)
  to_plan TEXT NOT NULL,              -- New plan
  change_type TEXT NOT NULL,           -- 'upgrade', 'downgrade', 'reactivation', 'cancellation', 'trial_start'
  timing TEXT NOT NULL,                -- 'immediate', 'scheduled', 'at_period_end'
  was_cancelled INTEGER DEFAULT 0,     -- 1 if subscription was cancelled before this change
  stripe_subscription_id TEXT,         -- Stripe subscription ID (for reconciliation)
  stripe_event_id TEXT,                -- Stripe webhook event ID (for debugging)
  metadata_json TEXT,                  -- JSON: {prorated_amount, effective_date, etc.}
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_plan_change_history_user_id ON plan_change_history(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_change_history_created_at ON plan_change_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_change_history_change_type ON plan_change_history(change_type);
CREATE INDEX IF NOT EXISTS idx_plan_change_history_timing ON plan_change_history(timing);

-- Backfill: After creating plan_change_history, mark users who previously had paid plans
-- Note: This must run after plan_change_history exists (migration 011).
UPDATE users SET has_ever_paid = 1
WHERE id IN (
  SELECT DISTINCT COALESCE(pch.user_id, 0) FROM plan_change_history pch
  WHERE pch.to_plan IN ('essential', 'pro', 'premium')
     OR pch.from_plan IN ('essential', 'pro', 'premium')
);

