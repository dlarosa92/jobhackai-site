-- Migration: Add plan and subscription columns to users table
-- Purpose: Move plan storage from KV to D1 as source of truth
-- Date: 2025-01-20
--
-- This migration adds all columns needed to store user plan and subscription
-- data in D1, making it the single source of truth instead of KV storage.

-- Add plan column (default 'free' for existing users)
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free';

-- Add Stripe subscription tracking columns
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT;

-- Add trial/subscription timing columns (ISO 8601 datetime strings)
ALTER TABLE users ADD COLUMN trial_ends_at TEXT;
ALTER TABLE users ADD COLUMN current_period_end TEXT;
ALTER TABLE users ADD COLUMN cancel_at TEXT;  -- If cancel_at_period_end is true

-- Add scheduled plan change tracking (for downgrades)
ALTER TABLE users ADD COLUMN scheduled_plan TEXT;  -- Plan that will activate at scheduled_at
ALTER TABLE users ADD COLUMN scheduled_at TEXT;  -- ISO 8601 datetime

-- Add metadata tracking
ALTER TABLE users ADD COLUMN plan_updated_at TEXT DEFAULT (datetime('now'));

-- Create indexes for efficient plan queries
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);

