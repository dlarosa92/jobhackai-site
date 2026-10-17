ALTER TABLE campaign_items ADD COLUMN gmail_thread_id TEXT;

CREATE TABLE gmail_sync_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  sync_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  label_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  thread_count INTEGER NOT NULL
);

CREATE TABLE gmail_threads (
  thread_id TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  preview TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('needs_review', 'waiting')),
  last_message_at TEXT NOT NULL,
  impact TEXT NOT NULL DEFAULT 'prospect' CHECK (impact IN ('customer', 'prospect')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  seen_sync_id TEXT NOT NULL
);
