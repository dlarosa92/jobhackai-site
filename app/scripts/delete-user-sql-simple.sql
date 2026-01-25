-- ============================================================
-- DELETE ALL DATA FOR USER: qEueeTjiwRcRuVcguhKL3QwxAqD3
-- Email: jobshackai@gmail.com
-- ============================================================
-- 
-- INSTRUCTIONS:
-- 1. Go to Cloudflare Dashboard → D1 → Select database
-- 2. Click "Studio" tab  
-- 3. Copy the SQL block below and paste into the query editor
-- 4. Click "Run" or press Cmd/Ctrl + Enter
-- 5. Repeat for BOTH databases:
--    - jobhackai-dev-db
--    - jobhackai-qa-db
-- ============================================================

-- ============================================================
-- ALL-IN-ONE DELETION (Copy everything below this line)
-- ============================================================

-- Delete from tables without foreign keys (must delete manually)
DELETE FROM linkedin_runs WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM role_usage_log WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM cover_letter_history WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Delete from tables with foreign keys (using user's internal ID)
DELETE FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feedback_sessions WHERE resume_session_id IN (SELECT id FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3'));
DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM interview_question_sets WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feature_daily_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM cookie_consents WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM plan_change_history WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Delete the user record (this cascades to any remaining related records)
DELETE FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Also delete any other users with the same email (if duplicates exist)
DELETE FROM users WHERE email = 'jobshackai@gmail.com' AND auth_id != 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- ============================================================
-- VERIFICATION QUERIES (Run these after deletion to confirm)
-- ============================================================

-- Check if user still exists (should return 0)
SELECT COUNT(*) as user_count FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Check remaining records (all should return 0)
SELECT 
  (SELECT COUNT(*) FROM linkedin_runs WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3') as linkedin_runs_count,
  (SELECT COUNT(*) FROM role_usage_log WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3') as role_usage_log_count,
  (SELECT COUNT(*) FROM cover_letter_history WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3') as cover_letter_history_count;
