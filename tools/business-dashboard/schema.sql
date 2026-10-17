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
  sort_order INTEGER NOT NULL
);
