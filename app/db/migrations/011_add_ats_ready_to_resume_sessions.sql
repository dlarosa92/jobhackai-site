-- Migration: Add ats_ready flag to resume_sessions
-- Date: 2025-01-XX
-- Description: Adds explicit ATS readiness flag to resume_sessions table
-- 
-- This migration adds an INTEGER column (SQLite boolean) to explicitly track
-- whether ATS scoring has been completed for a resume session.
-- The column defaults to 0 (not ready) and is set to 1 when ATS scores are persisted.
--
-- To run this migration:
-- wrangler d1 execute <database-name> --remote --file app/db/migrations/011_add_ats_ready_to_resume_sessions.sql
--
-- Rollback (if needed):
-- ALTER TABLE resume_sessions DROP COLUMN ats_ready;

-- Add the ats_ready column
ALTER TABLE resume_sessions ADD COLUMN ats_ready INTEGER NOT NULL DEFAULT 0;

-- Backfill: set ats_ready = 1 where ATS data already exists
UPDATE resume_sessions 
SET ats_ready = 1 
WHERE rule_based_scores_json IS NOT NULL OR ats_score IS NOT NULL;
