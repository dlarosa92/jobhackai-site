-- Migration: Add rule_based_scores_json to resume_sessions
-- Date: 2025-01-XX
-- Description: Stores full rule-based ATS scores to avoid redundant scoring
-- 
-- This migration adds a TEXT column to store JSON-encoded ruleBasedScores object.
-- The column is nullable to maintain backward compatibility.
--
-- To run this migration:
-- wrangler d1 execute <database-name> --remote --file app/db/migrations/004_add_rule_based_scores_to_resume_sessions.sql
--
-- Rollback (if needed):
-- ALTER TABLE resume_sessions DROP COLUMN rule_based_scores_json;

ALTER TABLE resume_sessions ADD COLUMN rule_based_scores_json TEXT;

