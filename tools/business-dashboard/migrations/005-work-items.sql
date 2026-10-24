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
