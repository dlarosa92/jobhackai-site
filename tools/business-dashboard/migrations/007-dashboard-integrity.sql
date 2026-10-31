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

CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON work_receipts
BEGIN SELECT RAISE(ABORT,'Execution receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON work_receipts
BEGIN SELECT RAISE(ABORT,'Execution receipts are immutable'); END;
