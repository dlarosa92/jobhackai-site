-- Consent-owned campaign context. Apply before deploying its checkout and
-- consent handlers. Financial payment records are intentionally separate.
CREATE TABLE IF NOT EXISTS checkout_attributions (
  checkout_session_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('dev', 'qa', 'prod')),
  ga_client_id TEXT,
  ga_session_id TEXT,
  first_touch_json TEXT,
  last_touch_json TEXT,
  captured_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkout_attribution_user ON checkout_attributions(user_id);
CREATE INDEX IF NOT EXISTS idx_checkout_attribution_client ON checkout_attributions(client_id);
CREATE INDEX IF NOT EXISTS idx_checkout_attribution_subscription ON checkout_attributions(stripe_subscription_id);
