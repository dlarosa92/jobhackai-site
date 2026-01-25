-- ============================================================
-- MANUAL SQL DELETION FOR USER: qEueeTjiwRcRuVcguhKL3QwxAqD3
-- Email: jobshackai@gmail.com
-- ============================================================
-- 
-- INSTRUCTIONS:
-- 1. Open Cloudflare Dashboard → D1 → Select database (DEV or QA)
-- 2. Click "Studio" tab
-- 3. Copy and paste these SQL commands one by one, or all at once
-- 4. Run for BOTH databases: jobhackai-dev-db AND jobhackai-qa-db
--
-- ============================================================

-- Set the user ID and email (for easy modification)
-- User ID: qEueeTjiwRcRuVcguhKL3QwxAqD3
-- Email: jobshackai@gmail.com

-- ============================================================
-- STEP 1: Delete from tables WITHOUT foreign key constraints
-- (These must be deleted manually as they don't cascade)
-- ============================================================

-- Delete LinkedIn runs (uses TEXT user_id, not foreign key)
DELETE FROM linkedin_runs 
WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Delete role usage log (uses TEXT user_id, not foreign key)
DELETE FROM role_usage_log 
WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Delete cover letter history (uses TEXT user_id, not foreign key)
DELETE FROM cover_letter_history 
WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- ============================================================
-- STEP 2: Get the user's internal ID (for tables that use INTEGER foreign keys)
-- ============================================================

-- First, check if user exists and get the ID
-- Run this to see the user record:
SELECT id, auth_id, email, plan, created_at 
FROM users 
WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- ============================================================
-- STEP 3: Delete from tables WITH foreign keys (using user's internal ID)
-- Note: These will also be deleted automatically when we delete the user,
-- but we're doing it explicitly to ensure complete deletion
-- ============================================================

-- Delete resume sessions (cascades to feedback_sessions)
DELETE FROM resume_sessions 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete feedback sessions (if any remain after resume_sessions deletion)
DELETE FROM feedback_sessions 
WHERE resume_session_id IN (
  SELECT id FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3')
);

-- Delete usage events
DELETE FROM usage_events 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete interview question sets
DELETE FROM interview_question_sets 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete mock interview sessions
DELETE FROM mock_interview_sessions 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete mock interview usage
DELETE FROM mock_interview_usage 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete feature daily usage
DELETE FROM feature_daily_usage 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete cookie consents
DELETE FROM cookie_consents 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete plan change history (if table exists)
DELETE FROM plan_change_history 
WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- ============================================================
-- STEP 4: Delete the user record itself
-- This will cascade delete any remaining records in tables with foreign keys
-- ============================================================

DELETE FROM users 
WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- ============================================================
-- STEP 5: Also delete any other users with the same email
-- (In case there are duplicate entries)
-- ============================================================

DELETE FROM users 
WHERE email = 'jobshackai@gmail.com' 
  AND auth_id != 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- ============================================================
-- VERIFICATION: Check that everything is deleted
-- ============================================================

-- Verify user is deleted
SELECT COUNT(*) as remaining_users 
FROM users 
WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
-- Should return 0

-- Verify related records are deleted
SELECT 
  (SELECT COUNT(*) FROM linkedin_runs WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3') as linkedin_runs,
  (SELECT COUNT(*) FROM role_usage_log WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3') as role_usage_log,
  (SELECT COUNT(*) FROM cover_letter_history WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3') as cover_letter_history;
-- All should return 0

-- ============================================================
-- ALL-IN-ONE VERSION (if you want to run everything at once)
-- ============================================================

-- Uncomment and run this block to delete everything in one go:

/*
DELETE FROM linkedin_runs WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM role_usage_log WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM cover_letter_history WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feedback_sessions WHERE resume_session_id IN (SELECT id FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3'));
DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM interview_question_sets WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feature_daily_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM cookie_consents WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM plan_change_history WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM users WHERE email = 'jobshackai@gmail.com' AND auth_id != 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
*/
