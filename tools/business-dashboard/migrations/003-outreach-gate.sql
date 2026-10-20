CREATE TABLE IF NOT EXISTS outreach_messages (
  id TEXT PRIMARY KEY, business_key TEXT NOT NULL, recipient TEXT NOT NULL,
  revision TEXT NOT NULL, packet TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'review' CHECK(state IN ('review','queued','sending','sent','uncertain')),
  approved_revision TEXT, approved_at TEXT,
  history TEXT, history_at TEXT, routing TEXT, routing_at TEXT,
  attempt_id TEXT UNIQUE, sent_message_id TEXT, sent_thread_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_business ON outreach_messages(business_key);
CREATE INDEX IF NOT EXISTS outreach_recipient ON outreach_messages(recipient);
CREATE TABLE IF NOT EXISTS outreach_versions (
  message_id TEXT NOT NULL, revision TEXT NOT NULL, packet TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(message_id, revision)
);
CREATE TABLE IF NOT EXISTS outreach_blocks (
  recipient TEXT PRIMARY KEY, reason TEXT NOT NULL, evidence_id TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outreach_events (
  event_id TEXT PRIMARY KEY, message_id TEXT NOT NULL, revision TEXT NOT NULL,
  kind TEXT NOT NULL, evidence TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outreach_relay_state (
  id INTEGER PRIMARY KEY CHECK(id=1), checked_at TEXT NOT NULL, can_send INTEGER NOT NULL CHECK(can_send IN(0,1))
);
