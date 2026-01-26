-- SQL commands to delete a user from DEV and QA databases
-- Replace placeholders before running in Cloudflare D1 Studio.
--
-- Placeholders:
--   {{AUTH_ID}}  -> Firebase auth_id
--   {{EMAIL}}    -> User email (optional)

-- ============================================
-- FOR DEV DATABASE (jobhackai-dev-db)
-- ============================================

-- First, get the user ID
-- SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}';

-- Delete related records first
DELETE FROM linkedin_runs WHERE user_id = '{{AUTH_ID}}';
DELETE FROM role_usage_log WHERE user_id = '{{AUTH_ID}}';
DELETE FROM cover_letter_history WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM feature_daily_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM cookie_consents WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM feedback_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM interview_question_sets WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM mock_interview_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM mock_interview_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM plan_change_history WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');

-- Finally delete the user (this should cascade to related tables)
DELETE FROM users WHERE auth_id = '{{AUTH_ID}}';

-- Also delete by email if there are other entries
DELETE FROM users WHERE email = '{{EMAIL}}' AND auth_id != '{{AUTH_ID}}';

-- ============================================
-- FOR QA DATABASE (jobhackai-qa-db)
-- ============================================

-- First, get the user ID
-- SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}';

-- Delete related records first
DELETE FROM linkedin_runs WHERE user_id = '{{AUTH_ID}}';
DELETE FROM role_usage_log WHERE user_id = '{{AUTH_ID}}';
DELETE FROM cover_letter_history WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM feature_daily_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM cookie_consents WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM resume_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM feedback_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM interview_question_sets WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM mock_interview_sessions WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM mock_interview_usage WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');
DELETE FROM plan_change_history WHERE user_id = (SELECT id FROM users WHERE auth_id = '{{AUTH_ID}}');

-- Finally delete the user (this should cascade to related tables)
DELETE FROM users WHERE auth_id = '{{AUTH_ID}}';

-- Also delete by email if there are other entries
DELETE FROM users WHERE email = '{{EMAIL}}' AND auth_id != '{{AUTH_ID}}';
