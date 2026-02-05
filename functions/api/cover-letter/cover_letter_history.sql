-- Migration-ish SQL: Cover Letter history table (Option A)
-- Target DB: Site D1 binding (INTERVIEW_QUESTIONS_DB) used by /functions/api/*
--
-- Apply manually via wrangler d1 execute (DEV/QA/PROD), or rely on runtime ensureSchema().

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

CREATE INDEX IF NOT EXISTS idx_cover_letter_user_created
  ON cover_letter_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cover_letter_user_hash
  ON cover_letter_history(user_id, input_hash);

