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

-- Additive dashboard-only execution receipts. Never change approvals or native sends.
CREATE TABLE IF NOT EXISTS work_handoffs (
  decision_id TEXT PRIMARY KEY REFERENCES work_decisions(id),
  item_id TEXT NOT NULL REFERENCES work_items(id),
  revision TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  department TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','blocked','completed','superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  claimed_by TEXT,
  lease_until TEXT,
  due_at TEXT NOT NULL,
  next_check_at TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_handoffs_pending ON work_handoffs(status,due_at);
CREATE TRIGGER IF NOT EXISTS decision_handoff AFTER INSERT ON work_decisions
BEGIN
  UPDATE work_handoffs SET status='superseded', version=version+1, updated_at=NEW.created_at
    WHERE item_id=NEW.item_id AND status IN ('pending','claimed','blocked');
  INSERT INTO work_handoffs(decision_id,item_id,revision,action,note,department,due_at,created_at,updated_at)
    SELECT NEW.id,NEW.item_id,NEW.revision,NEW.action,NEW.note,json_extract(document,'$.department'),
      strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+2 hours'),NEW.created_at,NEW.created_at
    FROM work_items WHERE id=NEW.item_id AND NEW.action IN ('approve','changes');
END;
-- Recover the latest unresolved decisions once, including owner comments saved before this release.
INSERT OR IGNORE INTO work_handoffs(decision_id,item_id,revision,action,note,department,due_at,created_at,updated_at)
  SELECT d.id,d.item_id,d.revision,d.action,d.note,json_extract(w.document,'$.department'),
    strftime('%Y-%m-%dT%H:%M:%fZ',d.created_at,'+2 hours'),d.created_at,d.created_at
  FROM work_decisions d JOIN work_items w ON w.id=d.item_id AND w.snapshot_revision=d.revision
  WHERE d.action IN ('approve','changes') AND w.native_state NOT IN ('sent','published','closed','scheduled')
    AND NOT EXISTS(SELECT 1 FROM work_decisions later WHERE later.item_id=d.item_id
      AND (later.created_at>d.created_at OR (later.created_at=d.created_at AND later.id>d.id)));

CREATE TABLE IF NOT EXISTS workflow_policies (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  max_age_minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO workflow_policies VALUES
  ('preparation','Content and approval preparation',90,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('reconciliation','Source reconciliation',45,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('coordination','Daily department coordination',1560,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL REFERENCES workflow_policies(id),
  period TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','advanced','checked','blocked','failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  lease_until TEXT NOT NULL,
  baseline TEXT NOT NULL,
  result TEXT,
  UNIQUE(workflow,period)
);
CREATE INDEX IF NOT EXISTS workflow_runs_recent ON workflow_runs(workflow,started_at DESC);
CREATE TABLE IF NOT EXISTS workflow_alerts (
  id TEXT PRIMARY KEY,
  detail TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS analytics_reports (
  id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
-- Attribute successful writes to their own active executor run, never a concurrent workflow.
CREATE TABLE IF NOT EXISTS workflow_run_writes (
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  kind TEXT NOT NULL CHECK(kind IN ('item','source','coordination')),
  reference TEXT NOT NULL,
  version INTEGER NOT NULL,
  result TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(run_id,kind,reference,version)
);

-- Dashboard only. Execution evidence is separate from editable preparation notes.
CREATE TABLE IF NOT EXISTS work_receipts (
  event_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES work_items(id),
  candidate TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('dev_deployed','dev_verified','qa_deployed','qa_verified','production_deployed','production_verified','published','sent')),
  evidence_url TEXT NOT NULL,
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(item_id,stage)
);
CREATE TABLE IF NOT EXISTS board_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO board_revision VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS board_changed_work_items_insert AFTER INSERT ON work_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_items_update AFTER UPDATE ON work_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_items_delete AFTER DELETE ON work_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_decisions_insert AFTER INSERT ON work_decisions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_decisions_update AFTER UPDATE ON work_decisions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_decisions_delete AFTER DELETE ON work_decisions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_contributions_insert AFTER INSERT ON work_contributions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_contributions_update AFTER UPDATE ON work_contributions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_contributions_delete AFTER DELETE ON work_contributions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_health_insert AFTER INSERT ON source_health
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_health_update AFTER UPDATE ON source_health
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_health_delete AFTER DELETE ON source_health
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_handoffs_insert AFTER INSERT ON work_handoffs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_handoffs_update AFTER UPDATE ON work_handoffs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_handoffs_delete AFTER DELETE ON work_handoffs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_runs_insert AFTER INSERT ON workflow_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_runs_update AFTER UPDATE ON workflow_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_runs_delete AFTER DELETE ON workflow_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_alerts_insert AFTER INSERT ON workflow_alerts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_alerts_update AFTER UPDATE ON workflow_alerts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_alerts_delete AFTER DELETE ON workflow_alerts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_run_writes_insert AFTER INSERT ON workflow_run_writes
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_run_writes_update AFTER UPDATE ON workflow_run_writes
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_run_writes_delete AFTER DELETE ON workflow_run_writes
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_coordination_runs_insert AFTER INSERT ON coordination_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_coordination_runs_update AFTER UPDATE ON coordination_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_coordination_runs_delete AFTER DELETE ON coordination_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_campaign_items_insert AFTER INSERT ON campaign_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_campaign_items_update AFTER UPDATE ON campaign_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_campaign_items_delete AFTER DELETE ON campaign_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_threads_insert AFTER INSERT ON gmail_threads
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_threads_update AFTER UPDATE ON gmail_threads
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_threads_delete AFTER DELETE ON gmail_threads
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_sync_state_insert AFTER INSERT ON gmail_sync_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_sync_state_update AFTER UPDATE ON gmail_sync_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_sync_state_delete AFTER DELETE ON gmail_sync_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_messages_insert AFTER INSERT ON outreach_messages
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_messages_update AFTER UPDATE ON outreach_messages
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_messages_delete AFTER DELETE ON outreach_messages
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_feedback_insert AFTER INSERT ON outreach_feedback
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_feedback_update AFTER UPDATE ON outreach_feedback
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_feedback_delete AFTER DELETE ON outreach_feedback
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_events_insert AFTER INSERT ON outreach_events
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_events_update AFTER UPDATE ON outreach_events
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_events_delete AFTER DELETE ON outreach_events
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_board_resolutions_insert AFTER INSERT ON board_resolutions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_board_resolutions_update AFTER UPDATE ON board_resolutions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_board_resolutions_delete AFTER DELETE ON board_resolutions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_cache_insert AFTER INSERT ON source_cache
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_cache_update AFTER UPDATE ON source_cache
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_cache_delete AFTER DELETE ON source_cache
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_analytics_reports_insert AFTER INSERT ON analytics_reports
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_analytics_reports_update AFTER UPDATE ON analytics_reports
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_analytics_reports_delete AFTER DELETE ON analytics_reports
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_receipts_insert AFTER INSERT ON work_receipts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_receipts_update AFTER UPDATE ON work_receipts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_receipts_delete AFTER DELETE ON work_receipts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON work_receipts
BEGIN SELECT RAISE(ABORT,'Execution receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON work_receipts
BEGIN SELECT RAISE(ABORT,'Execution receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_blocks_insert AFTER INSERT ON outreach_blocks
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_blocks_update AFTER UPDATE ON outreach_blocks
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_blocks_delete AFTER DELETE ON outreach_blocks
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_relay_state_insert AFTER INSERT ON outreach_relay_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_relay_state_update AFTER UPDATE ON outreach_relay_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_relay_state_delete AFTER DELETE ON outreach_relay_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
