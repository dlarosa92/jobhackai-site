-- Run this on jobhackai-prod-db to match dev/QA schema.
-- 1) Add missing column to resume_sessions
-- 2) Create missing tables (order respects FKs)

-- Step 1: Add ats_ready to resume_sessions
ALTER TABLE resume_sessions ADD COLUMN ats_ready INTEGER NOT NULL DEFAULT 0;

-- Step 2: Create missing tables
CREATE TABLE cover_letter_history (
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

CREATE TABLE feature_daily_usage (
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

CREATE TABLE first_resume_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  resume_session_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE interview_question_sets (
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

CREATE TABLE linkedin_runs (
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
