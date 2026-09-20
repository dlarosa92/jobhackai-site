-- Apply after 024 and 025, before the payment-attribution handlers.
-- Deleting consent-owned checkout context must erase the marketing join;
-- financial records survive. One payment can belong to only one checkout.
CREATE TABLE IF NOT EXISTS stripe_payment_attributions (
  charge_id TEXT PRIMARY KEY REFERENCES stripe_collected_payments(charge_id) ON DELETE CASCADE,
  checkout_session_id TEXT NOT NULL REFERENCES checkout_attributions(checkout_session_id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_attribution_checkout ON stripe_payment_attributions(checkout_session_id);

-- One row per charge, including unattributed payments. Never fan out by
-- individual refunds, so multiple refund events cannot inflate revenue.
CREATE VIEW IF NOT EXISTS stripe_campaign_revenue AS
SELECT p.charge_id, p.environment, p.livemode, p.currency, p.charge_created_at,
  p.amount_captured AS gross_captured, COALESCE(r.refunded, 0) AS refunded,
  p.amount_captured - COALESCE(r.refunded, 0) AS net_collected,
  a.first_touch_json, a.last_touch_json,
  CASE WHEN a.checkout_session_id IS NOT NULL THEN 'consented_checkout' ELSE 'unattributed' END AS attribution_status
FROM stripe_collected_payments p
LEFT JOIN (SELECT charge_id, SUM(amount) AS refunded FROM stripe_payment_refunds WHERE status='succeeded' GROUP BY charge_id) r
  ON r.charge_id=p.charge_id
LEFT JOIN stripe_payment_attributions l ON l.charge_id=p.charge_id
LEFT JOIN checkout_attributions a ON a.checkout_session_id=l.checkout_session_id
  AND a.expires_at > CAST(strftime('%s','now') AS INTEGER)*1000
  AND EXISTS (SELECT 1 FROM cookie_consents c WHERE c.user_id=a.user_id AND
    CASE WHEN json_valid(c.consent_json) THEN json_extract(c.consent_json,'$.version')=1 AND json_type(c.consent_json,'$.analytics')='true' ELSE 0 END)
  AND NOT EXISTS (SELECT 1 FROM cookie_consents c WHERE c.client_id=a.client_id AND
    CASE WHEN json_valid(c.consent_json) THEN COALESCE(json_extract(c.consent_json,'$.version')=1 AND json_type(c.consent_json,'$.analytics')='true',0)=0 ELSE 1 END);
