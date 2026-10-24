CREATE TABLE IF NOT EXISTS monthly_costs (
  month TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_items (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  review_url TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'sent', 'scheduled', 'published', 'hold')),
  evidence TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sort_order INTEGER NOT NULL,
  impact TEXT NOT NULL DEFAULT 'campaign' CHECK (impact IN ('customer', 'prospect', 'campaign')),
  next_action TEXT NOT NULL DEFAULT '',
  gmail_thread_id TEXT
);

CREATE TABLE IF NOT EXISTS gmail_sync_state (
  id INTEGER PRIMARY KEY CHECK (id=1), sync_id TEXT NOT NULL, mailbox TEXT NOT NULL, label_id TEXT NOT NULL,
  started_at TEXT NOT NULL, completed_at TEXT NOT NULL, received_at TEXT NOT NULL, thread_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_threads (
  thread_id TEXT PRIMARY KEY, last_message_id TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL,
  preview TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('needs_review', 'waiting')), last_message_at TEXT NOT NULL,
  impact TEXT NOT NULL DEFAULT 'prospect' CHECK (impact IN ('customer', 'prospect')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), seen_sync_id TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS board_resolutions (
  item_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  handled_at TEXT NOT NULL,
  reopened_at TEXT,
  PRIMARY KEY (item_id, revision)
);
-- Additive, dashboard D1 only. Source records, decisions and delivery restrictions survive.
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  document TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1000,
  mutation_id TEXT,
  snapshot_revision TEXT,
  source_revision TEXT,
  native_state TEXT NOT NULL DEFAULT 'unknown',
  checked_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(source, source_id)
);
CREATE TABLE IF NOT EXISTS work_snapshots (
  item_id TEXT NOT NULL REFERENCES work_items(id),
  revision TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(item_id, revision)
);
CREATE TABLE IF NOT EXISTS work_decisions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES work_items(id),
  revision TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('approve','changes','decline')),
  note TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_decision_revision ON work_decisions(item_id, revision, created_at);
CREATE TABLE IF NOT EXISTS work_contributions (
  item_id TEXT NOT NULL REFERENCES work_items(id),
  department TEXT NOT NULL CHECK(department IN ('marketing','sales','product')),
  version INTEGER NOT NULL,
  document TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(item_id, department)
);
CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('current','unavailable','incomplete')),
  checked_at TEXT NOT NULL,
  last_success_at TEXT,
  evidence_url TEXT NOT NULL,
  detail TEXT NOT NULL,
  max_age_minutes INTEGER NOT NULL,
  requires_mac INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS coordination_runs (
  id TEXT PRIMARY KEY,
  cadence TEXT NOT NULL CHECK(cadence IN ('hourly','daily','weekly','lesson')),
  period TEXT NOT NULL,
  document TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(cadence, period)
);

CREATE TABLE IF NOT EXISTS outreach_feedback (
  message_id TEXT NOT NULL REFERENCES outreach_messages(id),
  revision TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('changes','decline')),
  note TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(message_id, revision)
);
CREATE TRIGGER IF NOT EXISTS work_dependencies_update BEFORE UPDATE OF document ON work_items
BEGIN
  SELECT RAISE(ABORT,'Unknown dependency') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.document,'$.dependencies') d WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE id=d.value));
  SELECT RAISE(ABORT,'Dependency cycle') WHERE EXISTS (
    WITH RECURSIVE descendants(id) AS (
      SELECT value FROM json_each(NEW.document,'$.dependencies')
      UNION SELECT j.value FROM descendants d JOIN work_items w ON w.id=d.id JOIN json_each(w.document,'$.dependencies') j
    ) SELECT 1 FROM descendants WHERE id=NEW.id);
END;

CREATE TABLE IF NOT EXISTS source_cache (
  source TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
