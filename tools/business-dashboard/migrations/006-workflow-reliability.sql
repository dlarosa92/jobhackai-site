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
  ('reconciliation','Source reconciliation',90,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
