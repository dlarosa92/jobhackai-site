-- ============================================================
-- WORKING SQL - Run each query ONE AT A TIME
-- User ID: qEueeTjiwRcRuVcguhKL3QwxAqD3
-- Email: jobshackai@gmail.com
-- ============================================================
-- 
-- IMPORTANT: Run each DELETE statement separately, one at a time
-- Don't run them all at once - D1 Studio may not execute all queries
-- ============================================================

-- STEP 1: Delete from tables without foreign keys (run each separately)
DELETE FROM linkedin_runs WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

DELETE FROM role_usage_log WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

DELETE FROM cover_letter_history WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- STEP 2: Get the user's internal ID first (run this to see the ID)
SELECT id, auth_id, email FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- STEP 3: Delete from tables with foreign keys (replace USER_ID_HERE with the ID from step 2)
-- Example: If the ID is 67, use: DELETE FROM resume_sessions WHERE user_id = 67;
DELETE FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

DELETE FROM interview_question_sets WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

DELETE FROM mock_interview_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

DELETE FROM mock_interview_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

DELETE FROM feature_daily_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

DELETE FROM cookie_consents WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

DELETE FROM plan_change_history WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- STEP 4: Delete the user record (THIS IS THE KEY ONE - run this separately)
DELETE FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- STEP 5: Delete any duplicate users with same email
DELETE FROM users WHERE email = 'jobshackai@gmail.com' AND auth_id != 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- VERIFY: Check if user is gone (should return 0 rows)
SELECT * FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
