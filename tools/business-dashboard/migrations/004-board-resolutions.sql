-- Dashboard only. Never mutates Gmail, directory review status or send restrictions.
CREATE TABLE IF NOT EXISTS board_resolutions (
  item_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  handled_at TEXT NOT NULL,
  reopened_at TEXT,
  PRIMARY KEY (item_id, revision)
);
