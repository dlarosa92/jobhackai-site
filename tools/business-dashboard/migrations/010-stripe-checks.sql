CREATE TABLE IF NOT EXISTS stripe_checks (
  id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS board_changed_stripe_checks_insert AFTER INSERT ON stripe_checks
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
