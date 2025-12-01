-- JobHackAI D1 Database Schema
-- Resume Feedback with persistent per-user history
--
-- This schema is used for DEV, QA, and PROD environments.
-- Each environment has its own D1 database bound as `env.DB`.

-- ============================================================
-- USERS TABLE
-- Stores user records linked to Firebase auth
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_id TEXT UNIQUE NOT NULL,          -- Firebase UID
  email TEXT,                            -- User email (from Firebase)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);

-- ============================================================
-- RESUME_SESSIONS TABLE
-- Each resume uploaded/analyzed by a user
-- ============================================================
CREATE TABLE IF NOT EXISTS resume_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT,                            -- User-friendly label (e.g., "Senior Data Engineer Resume")
  role TEXT,                             -- Target role (jobTitle from request)
  created_at TEXT DEFAULT (datetime('now')),
  raw_text_location TEXT,                -- Pointer to KV key (e.g., "resume:${resumeId}") or null
  ats_score INTEGER,                     -- Overall ATS score (0-100) for quick history display
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Migration: Add ats_score column if table already exists
-- Run this on existing databases:
-- ALTER TABLE resume_sessions ADD COLUMN ats_score INTEGER;

CREATE INDEX IF NOT EXISTS idx_resume_sessions_user_id ON resume_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_sessions_created_at ON resume_sessions(created_at DESC);

-- ============================================================
-- FEEDBACK_SESSIONS TABLE
-- Each feedback run linked to a resume session
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resume_session_id INTEGER NOT NULL,
  feedback_json TEXT NOT NULL,           -- Full structured feedback from OpenAI (JSON string)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (resume_session_id) REFERENCES resume_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_sessions_resume_session_id ON feedback_sessions(resume_session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_sessions_created_at ON feedback_sessions(created_at DESC);

-- ============================================================
-- USAGE_EVENTS TABLE
-- Logs usage for metering and analytics
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  feature TEXT NOT NULL,                 -- e.g., 'resume_feedback', 'resume_rewrite'
  tokens_used INTEGER,                   -- Token count from OpenAI (nullable)
  meta_json TEXT,                        -- Additional metadata (JSON string, nullable)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_feature ON usage_events(feature);
CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);

-- ============================================================
-- INTERVIEW_QUESTION_SETS TABLE
-- Stores generated question sets with selected questions for mock interviews
-- ============================================================
CREATE TABLE IF NOT EXISTS interview_question_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                -- Foreign key to users.id
  role TEXT NOT NULL,                      -- Target role (e.g., "Software Engineer")
  seniority TEXT,                          -- Level (e.g., "Senior", "Mid", "Junior")
  types_json TEXT NOT NULL,                -- JSON array of selected types (e.g., ["behavioral","technical"])
  questions_json TEXT NOT NULL,            -- Full questions array [{id,q,hint,example}, ...]
  selected_ids_json TEXT NOT NULL,         -- JSON array of selected indices [0,1,2]
  jd TEXT,                                 -- Optional job description for context
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_interview_question_sets_user_id ON interview_question_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_created_at ON interview_question_sets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_role ON interview_question_sets(role);

