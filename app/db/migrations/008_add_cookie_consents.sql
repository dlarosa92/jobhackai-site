-- Migration: Add cookie_consents table
-- Purpose: Store user cookie consent preferences in D1 as source of truth
-- Date: 2025-01-28
--
-- This migration creates a table to store cookie consent preferences for both
-- authenticated users (via user_id) and anonymous visitors (via client_id).
-- D1 is the source of truth; localStorage is used for UI performance only.
--
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS checks

CREATE TABLE IF NOT EXISTS cookie_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,           -- FK to users.id (nullable for anonymous)
  client_id TEXT,            -- Anonymous client identifier (nullable)
  consent_json TEXT NOT NULL,-- JSON: {version:1, analytics:bool, updatedAt:ISO}
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_cookie_consents_user_id ON cookie_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_client_id ON cookie_consents(client_id);

-- Unique constraint: one consent record per user OR client_id
-- Note: SQLite doesn't support partial unique indexes, so we'll enforce uniqueness
-- in application code (user_id takes precedence over client_id)

