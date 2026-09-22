-- Private editorial intake. No account relationship or automatic public listing.
CREATE TABLE IF NOT EXISTS directory_requests (
  id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  website TEXT NOT NULL,
  service_area TEXT NOT NULL,
  service_details TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','reviewing','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  abuse_hash TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK(notification_status IN ('pending','sending','accepted','needs_review')),
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  notification_first_attempt_at TEXT,
  notification_next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  notification_lease_until TEXT,
  notification_token TEXT,
  notification_provider_id TEXT,
  notification_accepted_at TEXT,
  notification_error TEXT
);
CREATE INDEX IF NOT EXISTS directory_requests_abuse ON directory_requests(abuse_hash, created_at);
CREATE INDEX IF NOT EXISTS directory_requests_notifications ON directory_requests(notification_status, notification_next_attempt_at);
