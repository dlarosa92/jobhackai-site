-- Run this on jobhackai-prod-db to match dev/QA schema.
-- 1) Add missing column to resume_sessions
-- 2) Create missing tables (order respects FKs)

-- Step 1: Add ats_ready to resume_sessions
ALTER TABLE resume_sessions ADD COLUMN ats_ready INTEGER NOT NULL DEFAULT 0;

-- Backfill: set ats_ready = 1 where ATS data already exists
UPDATE resume_sessions
SET ats_ready = 1
WHERE rule_based_scores_json IS NOT NULL OR ats_score IS NOT NULL;

-- Step 2: Create missing tables
CREATE TABLE IF NOT EXISTS cover_letter_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  company TEXT NULL,
  seniority TEXT NOT NULL,
  tone TEXT NOT NULL,
  job_description TEXT NOT NULL,
  resume_text TEXT NULL,
  cover_letter_text TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feature_daily_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  feature TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, feature, usage_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS first_resume_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  resume_session_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_question_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  seniority TEXT,
  types_json TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  selected_ids_json TEXT NOT NULL,
  jd TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS linkedin_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  role TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing',
  overall_score INTEGER,
  input_json TEXT NOT NULL,
  output_json TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  error_message TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0
);

-- Step 3: Create indexes for query performance
-- cover_letter_history indexes
CREATE INDEX IF NOT EXISTS idx_cover_letter_user_created
  ON cover_letter_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cover_letter_user_hash
  ON cover_letter_history(user_id, input_hash);

-- feature_daily_usage indexes
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_user_id ON feature_daily_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_feature ON feature_daily_usage(feature);
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_date ON feature_daily_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_feature_daily_usage_user_feature_date ON feature_daily_usage(user_id, feature, usage_date);

-- first_resume_snapshots indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_first_snapshot_user_id ON first_resume_snapshots(user_id);

-- interview_question_sets indexes
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_user_id ON interview_question_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_created_at ON interview_question_sets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_role ON interview_question_sets(role);

-- linkedin_runs indexes
CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_created ON linkedin_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_hash ON linkedin_runs(user_id, input_hash);
