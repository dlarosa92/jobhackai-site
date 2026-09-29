-- Apply after 026 before deploying enriched payment recording and delivery.
-- Verified financial breakdown contains no browser or personal identifiers.
CREATE TABLE IF NOT EXISTS stripe_payment_analytics_values (
  charge_id TEXT PRIMARY KEY REFERENCES stripe_collected_payments(charge_id) ON DELETE CASCADE,
  captured_minor INTEGER NOT NULL CHECK(captured_minor>0),
  value_minor INTEGER NOT NULL CHECK(value_minor>=0),
  tax_minor INTEGER NOT NULL CHECK(tax_minor>=0),
  currency TEXT NOT NULL,
  item_id TEXT NOT NULL,
  CHECK(value_minor+tax_minor=captured_minor)
);
CREATE TABLE IF NOT EXISTS analytics_delivery (
  event_key TEXT PRIMARY KEY,
  charge_id TEXT NOT NULL REFERENCES stripe_collected_payments(charge_id) ON DELETE CASCADE,
  checkout_session_id TEXT NOT NULL REFERENCES checkout_attributions(checkout_session_id) ON DELETE CASCADE,
  refund_id TEXT REFERENCES stripe_payment_refunds(refund_id),
  event_name TEXT NOT NULL CHECK(event_name IN ('purchase','refund')),
  event_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','validating','sending','accepted_unverified','rejected','uncertain','expired','ineligible')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  last_reason TEXT,
  http_status INTEGER,
  accepted_at INTEGER,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_delivery_pending ON analytics_delivery(state,next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_collected_payments_time ON stripe_collected_payments(environment,charge_created_at);
