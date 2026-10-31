-- Empty source shapes for isolated dashboard dev/QA databases only.
-- Never apply this fixture to the production ledger.
CREATE TABLE IF NOT EXISTS users(created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS mock_interview_sessions(created_at TEXT);
CREATE TABLE IF NOT EXISTS voice_sessions(status TEXT,ended_at TEXT);
CREATE TABLE IF NOT EXISTS stripe_collected_payments(charge_id TEXT,environment TEXT,livemode INTEGER,currency TEXT,charge_created_at INTEGER,amount_captured INTEGER);
CREATE TABLE IF NOT EXISTS stripe_payment_refunds(charge_id TEXT,status TEXT,currency TEXT,refund_created_at INTEGER,amount INTEGER);
CREATE TABLE IF NOT EXISTS directory_requests(id TEXT PRIMARY KEY,category TEXT,business_name TEXT,website TEXT,service_area TEXT,service_details TEXT,contact_email TEXT,review_status TEXT,created_at TEXT);
