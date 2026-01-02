-- Migration: Create role_templates and role_usage_log tables
-- Purpose: Enable hybrid role template lifecycle management (D1 as source of truth)
-- Date: 2025-01-28
--
-- This migration creates tables for:
-- - role_templates: Stores role skill templates (must_have, nice_to_have, tools)
-- - role_usage_log: Telemetry for role usage and keyword scores
-- - role_template_audit: Optional audit trail for template changes

-- ============================================================
-- ROLE_TEMPLATES TABLE
-- Stores role skill templates for ATS scoring
-- ============================================================
CREATE TABLE IF NOT EXISTS role_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_family TEXT UNIQUE NOT NULL,        -- e.g., "mobile_developer", "data_engineer"
  must_have_json TEXT NOT NULL,            -- JSON array: ["swift", "ios", ...]
  nice_to_have_json TEXT NOT NULL,         -- JSON array: ["combine", "mvvm", ...]
  tools_json TEXT NOT NULL,                -- JSON array: ["Xcode", "Git", ...]
  status TEXT DEFAULT 'active',            -- 'active', 'pending_review', 'deprecated'
  version INTEGER DEFAULT 1,               -- Increment on updates
  created_by TEXT,                         -- Admin email/identifier
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT,                        -- Admin who approved (if pending_review)
  approved_at TEXT                         -- When approved
);

CREATE INDEX IF NOT EXISTS idx_role_templates_family ON role_templates(role_family);
CREATE INDEX IF NOT EXISTS idx_role_templates_status ON role_templates(status);

-- ============================================================
-- ROLE_USAGE_LOG TABLE
-- Telemetry for role usage and keyword scores (gap detection)
-- ============================================================
CREATE TABLE IF NOT EXISTS role_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,                   -- Firebase UID
  role_label TEXT NOT NULL,                 -- User-entered role
  role_family TEXT NOT NULL,                -- Normalized family
  keyword_score INTEGER,                     -- 0-40 score
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_role_usage_log_family ON role_usage_log(role_family);
CREATE INDEX IF NOT EXISTS idx_role_usage_log_created_at ON role_usage_log(created_at DESC);

-- ============================================================
-- ROLE_TEMPLATE_AUDIT TABLE (Optional - for governance)
-- Audit trail for template changes
-- ============================================================
CREATE TABLE IF NOT EXISTS role_template_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_family TEXT NOT NULL,
  action TEXT NOT NULL,                    -- 'created', 'updated', 'approved', 'deprecated'
  old_data_json TEXT,                      -- Previous template JSON (for diffs)
  new_data_json TEXT,                      -- New template JSON
  changed_by TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_role_template_audit_family ON role_template_audit(role_family);
CREATE INDEX IF NOT EXISTS idx_role_template_audit_changed_at ON role_template_audit(changed_at DESC);


