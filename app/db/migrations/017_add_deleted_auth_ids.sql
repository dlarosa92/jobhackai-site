-- Tombstone table for deleted users.
-- Prevents Stripe webhooks from recreating user rows when KV tombstone is
-- unavailable or the write failed. D1 is authoritative; KV is best-effort cache.
-- 30-day retention covers Stripe's retry window with margin.

CREATE TABLE IF NOT EXISTS deleted_auth_ids (
  auth_id TEXT PRIMARY KEY,
  deleted_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deleted_auth_ids_deleted_at ON deleted_auth_ids(deleted_at);
