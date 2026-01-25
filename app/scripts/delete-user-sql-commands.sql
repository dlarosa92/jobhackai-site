-- SQL commands to delete user qEueeTjiwRcRuVcguhKL3QwxAqD3 from DEV and QA databases
-- Run these in Cloudflare D1 Studio for each database

-- ============================================
-- FOR DEV DATABASE (jobhackai-dev-db)
-- ============================================

-- First, get the user ID (should be 67 based on screenshot)
-- SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Delete related records first
DELETE FROM linkedin_runs WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM role_usage_log WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM cover_letter_history WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feature_daily_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM cookie_consents WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feedback_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM interview_question_sets WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM plan_change_history WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Finally delete the user (this should cascade to related tables)
DELETE FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Also delete by email if there are other entries
DELETE FROM users WHERE email = 'jobshackai@gmail.com' AND auth_id != 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- ============================================
-- FOR QA DATABASE (jobhackai-qa-db)
-- ============================================

-- First, get the user ID (should be 38 based on screenshot)
-- SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Delete related records first
DELETE FROM linkedin_runs WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM role_usage_log WHERE user_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
DELETE FROM cover_letter_history WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feature_daily_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM cookie_consents WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM feedback_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM interview_question_sets WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM mock_interview_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');
DELETE FROM plan_change_history WHERE user_id = (SELECT id FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3');

-- Finally delete the user (this should cascade to related tables)
DELETE FROM users WHERE auth_id = 'qEueeTjiwRcRuVcguhKL3QwxAqD3';

-- Also delete by email if there are other entries
DELETE FROM users WHERE email = 'jobshackai@gmail.com' AND auth_id != 'qEueeTjiwRcRuVcguhKL3QwxAqD3';
