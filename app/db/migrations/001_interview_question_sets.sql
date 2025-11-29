-- Migration: Create interview_question_sets table
-- JobHackAI Interview Questions D1 Storage
-- 
-- This table stores question sets generated for users, enabling:
-- - Persistent question sets across sessions
-- - Mock Interview integration with selected questions
-- - History/recent sets functionality

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

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_user_id ON interview_question_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_created_at ON interview_question_sets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_question_sets_role ON interview_question_sets(role);

