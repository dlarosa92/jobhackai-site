import { getDb } from './db.js';
import { canonicalEnvironmentName } from './stripe-environment.js';

// Exact session/subscription + customer + environment only. Never attribute a
// payment merely because the customer has other marketing context.
export function paymentAttributionStatement(db, { chargeId = null, checkoutId = null, environment, now = Date.now() }) {
  return db.prepare(`INSERT INTO stripe_payment_attributions(charge_id,checkout_session_id,linked_at)
    SELECT p.charge_id, MIN(a.checkout_session_id), ?1
    FROM stripe_collected_payments p JOIN checkout_attributions a
      ON a.stripe_customer_id=p.customer_id AND a.environment=p.environment
      AND ((p.checkout_session_id IS NOT NULL AND a.checkout_session_id=p.checkout_session_id)
        OR (p.checkout_session_id IS NULL AND p.subscription_id IS NOT NULL AND a.stripe_subscription_id=p.subscription_id))
    JOIN cookie_consents c ON c.user_id=a.user_id
    WHERE p.environment=?2 AND (?3 IS NULL OR p.charge_id=?3)
      AND (?4 IS NULL OR p.checkout_session_id=?4 OR p.subscription_id=(SELECT stripe_subscription_id FROM checkout_attributions WHERE checkout_session_id=?4))
      AND a.expires_at>?1 AND a.captured_at<=p.charge_created_at*1000+999
      AND CASE WHEN json_valid(c.consent_json) THEN json_extract(c.consent_json,'$.version')=1 AND json_type(c.consent_json,'$.analytics')='true' ELSE 0 END
      AND NOT EXISTS (SELECT 1 FROM cookie_consents x WHERE x.client_id=a.client_id AND
        CASE WHEN json_valid(x.consent_json) THEN COALESCE(json_extract(x.consent_json,'$.version')=1 AND json_type(x.consent_json,'$.analytics')='true',0)=0 ELSE 1 END)
    GROUP BY p.charge_id HAVING COUNT(DISTINCT a.checkout_session_id)=1
    ON CONFLICT(charge_id) DO NOTHING`).bind(now,environment,chargeId,checkoutId);
}

export function subscriptionAttributionStatement(db, { session, uid, environment }) {
  const subId=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
  if (!/^sub_[a-z0-9_]+$/i.test(subId || '') || session.mode!=='subscription' || session.status!=='complete') return null;
  return db.prepare(`UPDATE checkout_attributions SET stripe_subscription_id=?1
    WHERE checkout_session_id=?2 AND stripe_customer_id=?3 AND environment=?4
      AND user_id=(SELECT id FROM users WHERE auth_id=?5)
      AND (stripe_subscription_id IS NULL OR stripe_subscription_id=?1)`)
    .bind(subId,session.id,typeof session.customer==='string'?session.customer:session.customer?.id,environment,uid);
}

// A checkout callback and its captured charge may arrive in either order.
// Run this in the same financial/fulfilment batch so retries cannot leave an
// acknowledged event without its eligible link.
export function stageCheckoutAttribution(env, ctx, { session, uid }) {
  const db=getDb(env), environment=canonicalEnvironmentName(env);
  const subscription=subscriptionAttributionStatement(db,{session,uid,environment});
  if (subscription) ctx.statements.push(subscription);
  ctx.statements.push(paymentAttributionStatement(db,{checkoutId:session.id,environment}));
}
