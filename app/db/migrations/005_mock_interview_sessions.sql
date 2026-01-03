-- Migration: Create mock_interview_sessions table
-- JobHackAI Mock Interview D1 Storage
-- 
-- This table stores completed mock interview sessions with:
-- - User answers and AI-generated feedback
-- - Rubric scores and S+A=O analysis
-- - Session history for Pro/Premium users

-- ============================================================
-- MOCK_INTERVIEW_SESSIONS TABLE
-- Stores completed mock interview sessions with scoring results
-- ============================================================
CREATE TABLE IF NOT EXISTS mock_interview_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                -- Foreign key to users.id
  role TEXT NOT NULL,                      -- Target role (e.g., "Data Engineer")
  seniority TEXT NOT NULL,                 -- Level (e.g., "Senior", "Mid", "Junior")
  interview_style TEXT NOT NULL,           -- Style: "mixed", "behavioral", "technical", "leadership"
  question_set_id INTEGER,                 -- FK to interview_question_sets.id (nullable if AI-generated)
  question_set_name TEXT,                  -- Display name ("AI-generated" if null/generated)
  
  -- Overall scoring
  overall_score INTEGER NOT NULL,          -- Total score 0-100
  
  -- Rubric breakdown (denormalized for fast queries)
  relevance_score INTEGER NOT NULL,        -- Out of 30
  structure_score INTEGER NOT NULL,        -- Out of 25
  clarity_score INTEGER NOT NULL,          -- Out of 20
  insight_score INTEGER NOT NULL,          -- Out of 15
  grammar_score INTEGER NOT NULL,          -- Out of 10
  
  -- S+A=O analysis (percentages)
  situation_pct REAL NOT NULL,             -- Situation percentage (target ~5%)
  action_pct REAL NOT NULL,                -- Action percentage (target ~10%)
  outcome_pct REAL NOT NULL,               -- Outcome percentage (target ~85%)
  
  -- Full session data (JSON)
  qa_pairs_json TEXT NOT NULL,             -- Array of {q, a} pairs (truncated answers)
  feedback_json TEXT NOT NULL,             -- Full AI feedback: rubric notes, strengths, improvements, per-question
  
  -- Metadata
  created_at TEXT DEFAULT (datetime('now')),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (question_set_id) REFERENCES interview_question_sets(id) ON DELETE SET NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_mock_interview_sessions_user_id ON mock_interview_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_interview_sessions_created_at ON mock_interview_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_interview_sessions_role ON mock_interview_sessions(role);

-- ============================================================
-- MOCK_INTERVIEW_USAGE TABLE
-- Tracks monthly session usage for quota enforcement
-- ============================================================
CREATE TABLE IF NOT EXISTS mock_interview_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                -- Foreign key to users.id
  month TEXT NOT NULL,                     -- Format: "2025-12" (YYYY-MM)
  sessions_used INTEGER NOT NULL DEFAULT 0, -- Number of sessions this month
  last_reset_at TEXT,                      -- When the month quota was last reset
  
  UNIQUE(user_id, month),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mock_interview_usage_user_month ON mock_interview_usage(user_id, month);

