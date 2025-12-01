-- Migration: Create feature_daily_usage table
-- JobHackAI Daily Usage Quotas
-- 
-- This table tracks daily usage of features per user for quota enforcement.
-- Used for Interview Questions and other features that need daily limits.

-- ============================================================
-- FEATURE_DAILY_USAGE TABLE
-- Tracks daily usage counts per user per feature
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_daily_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  feature TEXT NOT NULL,                    -- e.g. 'interview_questions'
  usage_date TEXT NOT NULL,                 -- 'YYYY-MM-DD' in UTC
  count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, feature, usage_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_user_id ON feature_daily_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_feature ON feature_daily_usage(feature);
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_date ON feature_daily_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_user_feature_date ON feature_daily_usage(user_id, feature, usage_date);

