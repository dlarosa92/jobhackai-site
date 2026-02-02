-- Migration: Add has_ever_paid to users table
-- Purpose: Track whether a user has ever been on a paid plan (one-time trial enforcement)
-- Date: 2026-02-02
--
-- IMPORTANT: Existing databases must run this migration.
-- SQLite doesn't support IF NOT EXISTS for ADD COLUMN; running twice will error.

ALTER TABLE users ADD COLUMN has_ever_paid INTEGER NOT NULL DEFAULT 0;
