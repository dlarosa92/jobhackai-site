-- Apply before enabling the new charge/refund webhook events. No backfill.
-- These are financial records, not consent to send data to Analytics.
CREATE TABLE IF NOT EXISTS stripe_collected_payments (
  charge_id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  checkout_session_id TEXT,
  invoice_id TEXT,
  subscription_id TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('dev', 'qa', 'prod')),
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  amount_captured INTEGER NOT NULL CHECK (amount_captured > 0),
  charge_created_at INTEGER NOT NULL,
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collected_payments_customer ON stripe_collected_payments(customer_id);

CREATE TABLE IF NOT EXISTS stripe_payment_refunds (
  refund_id TEXT PRIMARY KEY,
  charge_id TEXT NOT NULL REFERENCES stripe_collected_payments(charge_id),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  refund_created_at INTEGER NOT NULL,
  last_event_id TEXT NOT NULL,
  refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_charge ON stripe_payment_refunds(charge_id);

-- Integer minor currency units; never add different currencies together.
-- Gross captures less succeeded refunds, before fees, taxes and disputes.
-- This is not profit, bank payouts, GA revenue, or campaign attribution.
CREATE VIEW IF NOT EXISTS stripe_collected_payment_totals AS
SELECT p.environment, p.livemode, p.currency,
  SUM(p.amount_captured) AS gross_captured,
  SUM(COALESCE(r.refunded, 0)) AS refunded,
  SUM(p.amount_captured - COALESCE(r.refunded, 0)) AS net_collected
FROM stripe_collected_payments p
LEFT JOIN (
  SELECT charge_id, SUM(amount) AS refunded FROM stripe_payment_refunds
  WHERE status = 'succeeded' GROUP BY charge_id
) r ON r.charge_id = p.charge_id
GROUP BY p.environment, p.livemode, p.currency;
