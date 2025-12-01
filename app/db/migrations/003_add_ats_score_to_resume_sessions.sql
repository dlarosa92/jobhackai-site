-- Migration: Add ats_score column to resume_sessions table
-- Date: 2025-12-01
-- Description: Adds ats_score INTEGER column to store overall ATS score (0-100) for quick history display
-- 
-- This migration has been executed on:
-- - jobhackai-dev-db (dev)
-- - jobhackai-qa-db (qa)
-- - jobhackai-prod-db (production)
--
-- To run this migration on a new database:
-- wrangler d1 execute <database-name> --remote --command "ALTER TABLE resume_sessions ADD COLUMN ats_score INTEGER;"

ALTER TABLE resume_sessions ADD COLUMN ats_score INTEGER;

