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
